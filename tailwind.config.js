const defaultColors = require("tailwindcss/colors")

/** @type {import('tailwindcss').Config} */
module.exports = {
	content: ["build/**/*.html"],
	theme: {
		colors: {
			black: "black",
			gray: defaultColors.neutral,
			white: "white",

			red: {
				pale: "#d66fa6",
				bright: "#d70071",
			},
			green: {
				pale: "#5dd496",
				bright: "#00d669",
			},
			yellow: {
				pale: "#ffd97f",
				bright: "#ffd900",
			},
			blue: {
				pale: "#4dadff",
				bright: "#1294ff",
			},
			coral: {
				pale: "#f5abb9",
				bright: "#f5627f",
			},
			sky: {
				pale: "#b4ebff",
				bright: "#52d1ff",
			},
		},

		extend: {
			listStyleType: {
				"upper-alpha": "upper-alpha",
				"upper-roman": "upper-roman",
			},
			maxWidth: {
				prose: "80ch",
			},
		},
	},
	plugins: [],
}
