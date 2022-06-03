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

class WasmModuleBuilder {
	constructor() {
		this._buffer = [
			0x00, 0x61, 0x73, 0x6D, // magic
			0x01, 0x00, 0x00, 0x00, // version
		];
		this._encoder = new TextEncoder();
	}
	pushByte(...b) {
		this._buffer.push(...b);
	}
	pushString(s) {
		const buf = this._encoder.encode(s);
		this.pushU32(buf.length);
		this._buffer.push(...buf);
	}
	pushU32(v) {
		const buffer = this._buffer;
		for (; v >= 0x80; v >>= 7) {
			buffer.push((v & 0x7f) | 0x80);
		}
		buffer.push(v);
	}
	section(id, cb) {
		this.pushByte(id);
		const oldBuffer = this._buffer;
		const sectionBuffer = []
		this._buffer = sectionBuffer
		cb();
		this._buffer = oldBuffer;
		this.pushU32(sectionBuffer.length);
		oldBuffer.push(...sectionBuffer);
	}
	toUint8Array() {
		return new Uint8Array(this._buffer);
	}
}

const builder = new WasmModuleBuilder();

builder.section(0, () => { // custom section
	builder.pushString("abc"); // custom section byte length
	builder.pushByte(0xca, 0xfe);
});

builder.section(1, () => { // type section
	builder.pushU32(1); // type vector length
	builder.pushByte(0x60); // functype
	builder.pushU32(0); // resulttype1 vector length
	builder.pushU32(1); // resulttype2 vector length
	builder.pushByte(0x7f); // numtype i32
});

builder.section(3, () => {  // function section
	builder.pushU32(1); // func vector length
	builder.pushU32(0); // typeidx
});

builder.section(7, () => { // export section
	builder.pushU32(1); // export vector length
	builder.pushString("main"); // name
	builder.pushByte(0x00); // func
	builder.pushU32(0); // funcidx
});

// start section?

builder.section(10, () => { // code section
	builder.pushU32(1); // code vector length
	builder.pushU32(4); // code size
	builder.pushU32(0); // locals vector length
	builder.pushByte(0x41); builder.pushU32(5); // i32.const n
	builder.pushByte(0x0b); // end
});

const bytecode = builder.toUint8Array();

const hexdump = (buffer) => {
	for (let i=0; i < buffer.length; i += 16) {
		const slice = Array.from(buffer.slice(i, i+16));
		const pos = i.toString(16).padStart(8, "0")
		const hex = slice.map((byte, i) => {
			return byte.toString(16).padStart(2, "0") + (i === 7 ? " " : "");
		}).join(" ").padEnd(48);
		const chr = slice.map((byte) => {
			return byte >= 32 && byte < 127 ? String.fromCharCode(byte) : ".";
		});
		out.log(`${pos}  ${hex}  |${chr.join("")}|`);
	}
}

out.log(`Bytecode length: ${bytecode.length}`)
hexdump(bytecode);

const imports = {
	imports: {
		log(arg) {
			out.log(arg);
		},
	},
};

try {
	out.log("Creating module...")
	const module = new WebAssembly.Module(bytecode);
	out.log("Instantiating...")
	const instance = new WebAssembly.Instance(module, imports);
	out.log("Executing `main`...")
	out.log(`=> ${instance.exports.main()}`);
} catch (err) {
	out.error(err);
	throw err;
}
