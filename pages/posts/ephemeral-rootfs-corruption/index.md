<script frontmatter>
title = "NixOS: Avoiding filesystem corruption with hibernation and ephemeral root"
layout = "post"
abstract = `When resuming from hibernation on a NixOS installation with an ephemeral root filesystem you might run into subtle filesystem corruption issues. Here's why and how to avoid them.`
lastModified = new Date(Date.parse("2023-06-06"))
</script>

I was recently hit by [another](../filesystem-restore/) filesystem corruption issue on my laptop where I'm running NixOS on a Btrfs partition that's rolled back to an empty snapshot on each boot (similar to what's described in the popular post ["Erase your darlings"](https://grahamc.com/blog/erase-your-darlings/) by Graham Christensen but adapted for Btrfs). This happened right before I was leaving for a job interview where I needed that laptop so I was understandably annoyed and started testing alternative partition- and filesystem layouts that suite my needs. During those tests I've noticed a huge mistake in how I've implemented the rollback that comes into play when resuming from hibernation and I believe that might be responsible for the corruption incidents I've experienced. It's also easy to make that same mistake when setting up an ephemeral root FS for yourself using the guides available online, so I'm sharing my fix here.

## The problem

This was the code that implemented the rollback in my old configuration:

```nix
{
  # unrelated stuff...

  boot.initrd.postDeviceCommands = pkgs.lib.mkBefore ''
    mkdir /nixos
    mount /dev/mapper/crypt -o subvol=/ /nixos

    echo "Subvolumes at boot:"
    btrfs subvolume list -o /nixos/root

    echo "Deleting weird subvolumes that are already there for some reason..."
    btrfs subvolume delete /nixos/root/srv
    btrfs subvolume delete /nixos/root/tmp
    btrfs subvolume delete /nixos/root/var/lib/machines
    btrfs subvolume delete /nixos/root/var/lib/portables

    echo "Rolling back root subvolume..."
    btrfs subvolume delete /nixos/root \
      && btrfs subvolume snapshot /nixos/root-blank /nixos/root \
      || { echo "Contents of root subvolume:"; ls -a /nixos/root; }
    umount /nixos
  '';

  # unrelated stuff...
}
```

**If you don't use hibernation, this is fine.** However, with hibernation there's a problem: `postDeviceCommands` get injected into the NixOS-generated initrd script _before_ the point where swap devices are checked for hibernation images and the system resumes from hibernation (compare: [`postDeviceCommands` placeholder on line 270](https://github.com/NixOS/nixpkgs/blob/9b34aacbc7df9b1531b4ce2943ed473a7a465166/nixos/modules/system/boot/stage-1-init.sh#L270), [resume code on line 453](https://github.com/NixOS/nixpkgs/blob/9b34aacbc7df9b1531b4ce2943ed473a7a465166/nixos/modules/system/boot/stage-1-init.sh#L453) of the stage 1 init script). [According to the kernel docs](https://www.kernel.org/doc/html/v6.1/power/swsusp.html) you shouldn't touch filesystems at all when they're still in use by a hibernated system (not even readonly-mount them), so deleting and restoring a mounted subvolume is probably about the unhealthiest thing you can do to a filesystem in that case.

{{#> box}}

I'm surprised Btrfs managed to survive for so long under this treatment.

{{/box}}

## The fix

There are multiple ways to fix this. If you use systemd in stage 1, you might be able to hook the rollback step in at a point that happens before the root filesystem is mounted but after swap devices have been checked for hibernation images. [This thread](https://discourse.nixos.org/t/impermanence-vs-systemd-initrd-w-tpm-unlocking/25167/3) on the NixOS Discourse might be useful to you.

I didn't use systemd in stage 1 and didn't intend to switch to it, so I chose a different solution: My initrd checks for the existence of a special file on another (otherwise unused and unmounted) filesystem and only if that file exists, proceeds with the rollback and removes the file. The file is created by a systemd service just before shutdown so (under normal circumstances) it doesn't exist when resuming from hibernation. In addition to preventing rollbacks just before resuming, this setup also preserves my root filesystem after an unclean shutdown (e.g. after power loss) and it gives me the ability to boot into a live system and delete the rollback marker file myself to prevent a rollback on boot.

Here's the partition layout I'm using now. The top-level items are partitions on a GPT-formatted disk so they are identified by partition labels. Everything below is identified by filesystem labels.

- `boot`: EFI system partition
  - `boot`: FAT32 filesystem
- `meta`: regular partition
  - `crypt-meta`: LUKS partition
    - `meta`: ext4 filesystem
- `primary`: regular partition
  - `crypt-primary`: LUKS partition
    - `primary`: Btrfs
      - `nix`: subvolume
      - `persist`: subvolume
      - `root`: subvolume
        - Has snapshot named `root-blank`
      - `snapshots`: subvolume
      - `swap`: subvolume

And the config that's responsible for defining mounted filesystems and performing the rollback:

```nix
{ pkgs, ... }:

{
  boot.supportedFilesystems = [ "btrfs" ];

  boot.resumeDevice = "/dev/disk/by-label/primary";
  boot.kernelParams = [ "resume_offset=${builtins.toString (import ../swapfile-resume-offset.nix)}" ];

  boot.initrd.postDeviceCommands = ''
    mkdir /meta
    mount -t ext4 /dev/disk/by-label/meta /meta

    if [ -e /meta/clear-for-rollback ]; then
      echo "Clear for root filesystem rollback"
      rm /meta/clear-for-rollback

      mkdir /primary
      mount -t btrfs /dev/disk/by-label/primary /primary

      echo "Subvolumes at boot:"
      btrfs subvolume list -o /primary/root

      echo "Deleting weird subvolumes that are already there for some reason..."
      btrfs subvolume delete /primary/root/srv
      btrfs subvolume delete /primary/root/tmp
      btrfs subvolume delete /primary/root/var/lib/machines
      btrfs subvolume delete /primary/root/var/lib/portables

      echo "Rolling back root subvolume..."
      btrfs subvolume delete /primary/root \
        && btrfs subvolume snapshot /primary/root-blank /primary/root \
        || { echo "Contents of root subvolume:"; ls -a /primary/root; }

      umount /primary
    else
      echo "NOT clear for root filesystem rollback"
    fi

    umount /meta
  '';

  boot.initrd.luks.reusePassphrases = true;
  boot.initrd.luks.devices = {
    meta.device = "/dev/disk/by-label/crypt-meta";
    primary.device = "/dev/disk/by-label/crypt-primary";
  };

  fileSystems = {
    "/" = {
      device = "/dev/disk/by-label/primary";
      fsType = "btrfs";
      options = [ "subvol=root" ];
    };

    "/nix" = {
      device = "/dev/disk/by-label/primary";
      fsType = "btrfs";
      options = [ "subvol=nix" ];
    };

    "/persist" = {
      device = "/dev/disk/by-label/primary";
      fsType = "btrfs";
      options = [ "subvol=persist" ];
      neededForBoot = true;
    };

    "/var/lib/swap" = {
      device = "/dev/disk/by-label/primary";
      fsType = "btrfs";
      options = [ "subvol=swap" ];
      neededForBoot = true;
    };

    "/snapshots" = {
      device = "/dev/disk/by-label/primary";
      fsType = "btrfs";
      options = [ "subvol=snapshots" ];
    };

    "/boot" = {
      device = "/dev/disk/by-label/boot";
      fsType = "vfat";
    };
  };

  swapDevices = [
    { device = "/var/lib/swap/swapfile"; }
  ];

  systemd.services.set-rollback-flag = {
    enable = true;
    path = with pkgs; [ coreutils util-linux ];
    script = ''
      mkdir -p /tmp/fs-meta
      mount -t ext4 /dev/disk/by-label/meta /tmp/fs-meta
      touch /tmp/fs-meta/clear-for-rollback
      umount /tmp/fs-meta
    '';

    serviceConfig.Type = "oneshot";
    unitConfig = {
      DefaultDependencies = false; # removes Conflicts= with shutdown.target
      RemainAfterExit = true;
    };

    before = [ "shutdown.target" ];
    conflicts = [ ];
    wantedBy = [ "shutdown.target" ];
  };
}
```

Whether anything is gained by putting the `meta` filesystem in a LUKS partition is debatable but I'm using `boot.initrd.luks.reusePassphrases` to avoid having to enter two passphrases, so I don't see a huge downside either other than taking a few seconds longer to boot. Of course you're free to set up your system however you like.

Notice anything wrong with this setup? Feel free to send me an email at `mica @ domain of this site`.
