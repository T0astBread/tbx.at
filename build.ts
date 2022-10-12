import * as chokidar from "chokidar"
import * as fs from "node:fs/promises"
import * as fsutil from "./fs"
import * as handlebars from "handlebars"
import * as mdit from "markdown-it"
import * as mutex from "./mutex"
import * as path from "node:path"
import * as vm from "node:vm"
import postcss from "postcss"
import Token = require("markdown-it/lib/token")

/** {@link paths} holds constants for file system paths that are used more than once. */
const paths = {
	build: path.resolve("build"),
	components: path.resolve("components"),
	cssEntryPoint: path.resolve("main.css"),
	cssOutput: path.resolve("build", "main.css"),
	pages: path.resolve("pages"),
	watchClient: path.resolve("watch-client.html"),
} as const

/** {@link BuildError} is used to report the fact that there were errors during the build process. */
class BuildError extends Error {}

/** {@link PageContext} holds data about a page that is passed around while building that page. */
type PageContext = {
	errorKey: string
	srcPath: string
}

/** {@link identityTag} is a template tag function that returns the template string unmodified. */
const identityTag = (strings: TemplateStringsArray, ...values: any[]) =>
	String.raw({ raw: strings }, ...values)

/** {@link tw} annotates Tailwind CSS class strings. */
const tw = identityTag

enum MarkdownListType {
	Bullet,
	Ordered,
}

/** {@link markdownStyles} returns a Tailwind CSS class string to apply for the given Markdown token. */
function markdownStyles(ctx: {
	headingLevel: number | undefined
	strong: boolean
	em: boolean
	lists: MarkdownListType[]
	pageCtx: PageContext
	token: Token
}): string {
	switch (ctx.token.type) {
		case "fence":
			return tw`font-mono bg-gray-200 dark:bg-gray-700 p-2 rounded block overflow-auto`
		case "code_inline":
			return tw`font-mono bg-gray-200 dark:bg-gray-600 p-1 rounded`
		case "link_open":
			return tw`text-blue-bright dark:text-coral-bright`
		case "paragraph_open":
			return tw`mx-2 my-4 text-justify`
		case "ordered_list_open":
			return tw`ml-4 list-${
				["decimal", "upper-alpha", "upper-roman"][
					Math.min(ctx.lists.length - 1, 2)
				]
			} list-inside`
		case "bullet_list_open":
			return tw`ml-4 ${ctx.lists.length === 1 ? "my-4" : ""}`
	}

	if (ctx.token.type === "heading_open") {
		switch (ctx.token.tag) {
			case "h1":
				return tw`mx-2 my-8 text-3xl`
			case "h2":
				return tw`mx-2 my-4 text-2xl`
			case "h3":
				return tw`mx-2 my-4 text-xl`
			case "h4":
			case "h5":
			case "h6":
				return tw`mx-2`
		}
	}

	if (
		ctx.token.type === "list_item_open" &&
		ctx.lists.at(-1) === MarkdownListType.Bullet
	) {
		return [
			tw`before:content-[' '] before:inline-block before:w-1.5 before:h-1.5 before:mb-[0.17rem] before:mr-2`,
			[
				tw`before:rounded before:bg-black before:dark:bg-white`,
				tw`before:rounded before:border before:border-black before:dark:border-white`,
				tw`before:bg-black before:dark:bg-white`,
				tw`before:border before:border-black before:dark:border-white`,
			][Math.min(ctx.lists.length - 1, 3)],
		].join(" ")
	}

	return ""
}

/**
 * {@link build} builds the site.
 *
 * @param signal can be used to abort the build before it finishes
 * @param withinWatch if true, the build process injects code required for hot reloading the page in a browser
 */
async function build(signal: AbortSignal, withinWatch: boolean = false) {
	//#region Cancel build if aborted
	function checkCancelBuild() {
		if (signal.aborted) {
			console.info("Cancelling build")
		}
		return signal.aborted
	}

	if (checkCancelBuild()) {
		return
	}
	//#endregion

	//#region Create and truncate the build directory
	try {
		const stat = await fs.lstat(paths.build)
		if (!stat.isDirectory()) {
			throw new Error('"build" exists but is not a directory')
		}
		await fsutil.truncateDir(paths.build)
	} catch {
		await fs.mkdir(paths.build)
	}
	//#endregion

	const watchClient = await fs.readFile(paths.watchClient, "utf-8")

	const hb = handlebars.create()
	hb.registerHelper("empty", (s?: string) => (s?.trim().length ?? 0) === 0)
	hb.registerHelper(
		"isoDate",
		(d: Date) =>
			`${d.getUTCFullYear()}-${(d.getUTCMonth() + 1)
				.toString()
				.padStart(2, "0")}-${d.getUTCDate().toString().padStart(2, "0")}`
	)
	hb.registerHelper("linkEquals", (a, b) => {
		function normalizeLink(link: string) {
			if (link === ".") return false // The home pages shouldn't match anything.
			return link.replace(/^\//, "").replace(/\/$/, "")
		}
		return normalizeLink(a) === normalizeLink(b)
	})

	const errors = new Map<string, any[]>()

	function pushError(key: string, err: any) {
		const arr = errors.get(key)
		if (arr) {
			arr.push(err)
		} else {
			errors.set(key, [err])
		}
	}

	function parseFrontMatter(src: string): {
		src: string
		frontMatter: { [key: string]: any }
	} {
		if (!src.startsWith("<script frontmatter>\n")) {
			return { src, frontMatter: {} }
		}

		const lines = src.split("\n")
		let i = 1
		while (i < lines.length) {
			const line = lines[i++]
			if (line === "</script>") {
				break
			}
		}

		const frontMatterLines = lines.slice(1, i - 1)
		const srcLines = lines.slice(i)

		const ctx = vm.createContext({
			siteTitle: "tbx.at",
			withinWatch,
		})
		vm.runInContext(frontMatterLines.join("\n"), ctx)

		return {
			src: srcLines.join("\n"),
			frontMatter: ctx,
		}
	}

	//#region Build components
	for await (const file of await fsutil.walkFiles(paths.components)) {
		if (checkCancelBuild()) {
			return
		}

		if (file.entry.isDirectory()) {
			continue
		}

		const componentName = path
			.relative(paths.components, file.path)
			.replace("/", "-")
			.replace(/\.html$/, "")

		try {
			const srcWithFrontMatter = await fs.readFile(file.path, "utf-8")
			const { src, frontMatter } = parseFrontMatter(srcWithFrontMatter)
			hb.registerPartial(componentName, (context, options) =>
				hb.compile(src)(
					{
						...frontMatter,
						...context,
					},
					options
				)
			)
		} catch (err) {
			pushError(`component: ${componentName}`, err)
		}
	}
	//#endregion

	//#region Build pages
	const mdRenderer = mdit({
		html: true,
	})
	mdRenderer.use((m) => {
		m.core.ruler.push("classes", (state) => {
			const pageCtx = state.env.pageCtx as PageContext
			state.env.headingLevel = undefined
			state.env.strong = false
			state.env.em = false
			state.env.lists = []

			function walkTokens(tokens: Token[]) {
				for (const token of tokens) {
					try {
						if (
							(token.type === "bullet_list_open" ||
								token.type === "ordered_list_open") &&
							!token.attrGet("role")
						) {
							token.attrSet("role", "list")
						}
						switch (token.type) {
							case "heading_open":
								state.env.headingLevel = parseInt(token.tag.substring(1))
								break
							case "heading_close":
								state.env.headingLevel = undefined
								break
							case "strong_open":
								state.env.strong = true
								break
							case "strong_close":
								state.env.strong = false
								break
							case "em_open":
								state.env.em = true
								break
							case "em_close":
								state.env.em = false
								break
							case "bullet_list_open":
								state.env.lists.push(MarkdownListType.Bullet)
								break
							case "ordered_list_open":
								state.env.lists.push(MarkdownListType.Ordered)
								break
							case "bullet_list_close":
							case "ordered_list_close":
								state.env.lists.pop()
								break
							case "link_open":
								const href = token.attrGet("href")
								if (href && href.match(/^\w+:/)) {
									token.attrSet("rel", "external noopener")
								}
								break
						}
						const styles = markdownStyles({
							headingLevel: state.env.headingLevel,
							strong: state.env.strong,
							em: state.env.em,
							lists: state.env.lists,
							pageCtx,
							token,
						}).trim()
						if (styles.length > 0) {
							token.attrJoin("class", styles)
						}
						if (token.children) {
							walkTokens(token.children)
						}
					} catch (err) {
						pushError(pageCtx.errorKey, err)
					}
				}
			}

			walkTokens(state.tokens)

			delete state.env.headingLevel
			delete state.env.strong
			delete state.env.em
			delete state.env.lists
		})
	})

	function renderMarkdown(ctx: PageContext, md: string) {
		return mdRenderer.render(md, {
			pageCtx: ctx,
		})
	}

	for await (const file of fsutil.walkFiles(paths.pages)) {
		if (checkCancelBuild()) {
			return
		}

		if (file.entry.isDirectory()) {
			continue
		}

		const relativePath = path.relative(paths.pages, file.path)
		const ctx: PageContext = {
			srcPath: relativePath,
			errorKey: `page: ${relativePath}`,
		}

		try {
			const ext = path.extname(file.path)

			if (ext === ".md" || ext === ".html") {
				const link = path.join(
					file.entry.name === `index${ext}`
						? path.dirname(relativePath)
						: relativePath.slice(0, -ext.length)
				)
				const outputPath =
					relativePath === `404${ext}`
						? path.resolve(paths.build, "404.html")
						: path.resolve(paths.build, link, "index.html")
				await fs.mkdir(path.dirname(outputPath), {
					recursive: true,
				})
				const srcWithFrontMatter = await fs.readFile(file.path, "utf-8")
				const { src, frontMatter } = parseFrontMatter(srcWithFrontMatter)
				const layout = frontMatter["layout"] || "default"
				const afterHB = hb.compile(
					`{{#> layout-${layout}}}\n${src}\n{{/layout-${layout}}}`
				)({
					page: {
						link,
					},
					...frontMatter,
				})
				const html = ext === ".html" ? afterHB : renderMarkdown(ctx, afterHB)
				await fs.writeFile(outputPath, withinWatch ? html + watchClient : html)
			} else {
				const outputPath = path.resolve(paths.build, relativePath)
				await fs.mkdir(path.dirname(outputPath), {
					recursive: true,
				})
				await fs.copyFile(file.path, outputPath)
			}
		} catch (err) {
			pushError(ctx.errorKey, err)
		}
	}
	//#endregion

	//#region Build CSS
	const cssSrc = await fs.readFile(paths.cssEntryPoint, "utf-8")
	const css = await postcss([
		require("tailwindcss"),
		require("autoprefixer"),
		require("cssnano"),
	]).process(cssSrc, {
		from: paths.cssEntryPoint,
		to: paths.cssOutput,
	})
	await fs.writeFile(paths.cssOutput, css.content)
	if (css.map) {
		await fs.writeFile(paths.cssOutput + ".map", css.map.toString())
	}
	//#endregion

	//#region Report errors during build and refresh page when watching
	const errorLines = [...errors.entries()]
		.map(([thing, errs]) => ({ thing, errs }))
		.sort((a, b) => a.thing.localeCompare(b.thing))
		.flatMap(({ thing, errs }) => errs.map((err) => ({ thing, err })))

	errorLines.forEach(({ thing, err }) => console.error(thing, err))

	if (errors.size > 0) {
		if (withinWatch) {
			const errorText = errorLines
				.map(
					({ thing, err }) =>
						`${thing}: ${err instanceof Error ? err.message : err}`
				)
				.join("\n")
			await fs.writeFile(
				path.resolve(paths.build, "_errors.html"),
				`<pre>${errorText}</pre>${watchClient}`
			)
			await fs.writeFile(
				path.resolve(paths.build, "_watch-date.txt"),
				`err ${Date.now().toString()}`
			)
		}
		throw new BuildError("There were errors during the build")
	}

	if (withinWatch) {
		await fs.writeFile(
			path.resolve(paths.build, "_watch-date.txt"),
			Date.now().toString()
		)
	}
	//#endregion
}

/**
 * {@link watch} builds the site and rebuilds it when its source files change. It handles hot reloading in the browser.
 *
 * @param lifetime can be used to stop the watch process
 */
async function watch(lifetime: AbortSignal) {
	//#region Set up build with error handling
	let buildLifetime: AbortController | undefined = undefined
	const buildMutex = new mutex.Mutex()

	async function _build() {
		buildLifetime?.abort()
		buildLifetime = new AbortController()

		const unlockBuildMutex = await buildMutex.lock()
		try {
			console.info("Building...")
			await build(buildLifetime.signal, true)
		} catch (err) {
			if (!(err instanceof BuildError)) {
				throw err
			}
		} finally {
			console.info("Done building")
			unlockBuildMutex()
		}
	}

	await _build()
	//#endregion

	//#region Set up FS watchers
	const watcher = chokidar.watch(
		[
			paths.components,
			paths.cssEntryPoint,
			paths.pages,
			paths.watchClient,
			path.resolve("tailwind.config.js"),
		],
		{
			ignoreInitial: true,
		}
	)
	lifetime.addEventListener("abort", () => watcher.close())
	watcher.addListener("all", _build)

	const buildscriptWatcher = chokidar.watch("*.js", {
		ignoreInitial: true,
	})
	lifetime.addEventListener("abort", () => buildscriptWatcher.close())
	buildscriptWatcher.addListener("all", () => process.exit(5))
	//#endregion
}

//#region Global initialization
const lifetime = new AbortController()
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.once(signal, () => {
		console.info("Exiting due to", signal)
		lifetime.abort()
		process.kill(process.pid, signal)
	})
}

const operation = process.env.OP ?? "build"
console.info("Starting with operation:", operation)
switch (operation) {
	case "watch":
		watch(lifetime.signal)
		break
	case "build":
		build(lifetime.signal)
		break
	default:
		console.error("Unknown operation:", operation)
}
//#endregion
