<p class="text-center leading-5 my-5 mx-2">
Hey! I'm<br>
<span class="text-coral-bright font-bold text-lg">Mica</span><br>
<span class="text-gray-500 dark:text-gray-200 text-sm">and you're reading <span class="text-blue-pale" id="t">The</span> <span class="text-red-pale" id="b">Broken</span> <span class="text-green-pale" id="x">Xylophone</span> <span class="">dot A-T</span>™</span>
<p>

I'm interested in building infrastructure with [Nix(OS)](https://nixos.org) and functional programming. I love building software and computer systems to make my life better and I've created this website to share some thoughts and experiences related to that.

Other than that I also know a thing or two about web development, Go, and Java (+ some Kotlin).

In my day job I'm working on {{#> link href="https://symflower.com" rel="external noopener noreferrer"}}developer tooling to automate tasks around unit testing{{/link}}. I've worked on a few components in that company, most recently our editor integrations (VS Code and IntelliJ plugins, and a [language server](https://microsoft.github.io/language-server-protocol/)) as well as our websites.

Write me a nice email if you want at {{#> faux-code}}mica @ domain of this site{{/faux-code}}. My pronouns are "they/them" in English.

<script>
(() => {
const meanings = [
    ["The", "Broken", "Xylophone"],
    ["Take", "Back", "X11"],
    ["Testing,", "Benchmarking and", "eXtortion"],
    ["To", '<span style="font-size: 10.5px; top: -5.25px; position: relative; line-height: 0">Better</span>', "Xdo"],
    ["This while I steal your", "BTC &", "XMR"],
    ["The", "Banned", "XKCD"],
    ["Test", "Balloon", "Xanadu"],
    ["Terminal", "Browsers", "a-X-epted"],
    ["This", "Breaks", "Xterm"],
]

const s = sessionStorage.getItem("meaning")
const i = s
    ? (parseInt(s) + 1) % meanings.length
    : Math.floor(Math.random() * meanings.length)
sessionStorage.setItem("meaning", i)
const m = meanings[i]
t.innerHTML = m[0]
b.innerHTML = m[1]
x.innerHTML = m[2]
})()
</script>
