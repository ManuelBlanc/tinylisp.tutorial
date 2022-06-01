"use strict";
class Logger {
	constructor(id) {
		this.element = document.getElementById("output");
	}
	_write(str, className) {
		const date = new Date();
		const hh = date.getHours().toString().padStart(2, "0");
		const mm = date.getMinutes().toString().padStart(2, "0");
		const ss = date.getMinutes().toString().padStart(2, "0");
		const uuuu = date.getMilliseconds().toString().padStart(4, "0");
		const span = document.createElement("span");
		span.classList.add("entry");
		if (className) {
			span.classList.add(className);
		}
		span.dataset.timestamp = `${hh}:${mm}:${ss}.${uuuu}`;
		span.textContent = str + "\n";
		this.element.appendChild(span);
		return span;
	}
	log(str) {
		this._write(str);
	}
	error(str) {
		this._write(str + "\n" + Error().stack.replace(/^[^\n]+\n/, ""), "error");
	}
	warning(str) {
		this._write(str, "error");
	}
	clear() {
		this.element.innerText = "";
	}
}

const out = new Logger("output");

const bytecode = new Uint8Array([
	0x00, 0x61, 0x73, 0x6D, // magic
	0x01, 0x00, 0x00, 0x00, // version
]);

const imports = {
	imports: {
		log(arg) {
			out.log(arg);
		},
	},
};

try {
	const module = new WebAssembly.Module(bytecode);
	const instance = new WebAssembly.Instance(module, imports);
	instance.exports.main();	
} catch (err) {
	out.error(err);
	throw err;
}
