import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as syncfs from "node:fs"

/** {@link WalkEntry} holds data about a file produced during a {@link walkFiles} call. */
export type WalkEntry = {
	entry: syncfs.Dirent
	path: string
}

/**
 * {@link walkFiles} recurses over a file tree and yields all files and directories in that tree.
 *
 * Traversal happens depth-first and directory entries are yielded after the directoy's children.
 */
export async function* walkFiles(dir: string): AsyncGenerator<WalkEntry> {
	for await (const file of await fs.opendir(dir)) {
		const entry: WalkEntry = {
			entry: file,
			path: path.join(dir, file.name),
		}
		if (file.isDirectory()) {
			yield* walkFiles(entry.path)
		}
		yield entry
	}
}

/**
 * {@link truncateDir} deletes all files and directories in the given directory without deleting the directory itself.
 *
 * Deletion happens in the order that {@link walkFiles} yields files.
 */
export async function truncateDir(dir: string) {
	for await (const file of walkFiles(dir)) {
		if (file.entry.isDirectory()) {
			await fs.rmdir(file.path)
		} else {
			await fs.unlink(file.path)
		}
	}
}
