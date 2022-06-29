"use strict";
const ASSERT = (cond) => {
	if (!cond) throw new Error("assertion failed!");
};

class Logger {
	constructor(id) {
		this.element = document.getElementById("output");
	}
	_makeEntry() {
		const date = new Date();
		const hh = date.getHours().toString().padStart(2, "0");
		const mm = date.getMinutes().toString().padStart(2, "0");
		const ss = date.getMinutes().toString().padStart(2, "0");
		const uuuu = date.getMilliseconds().toString().padStart(3, "0");
		const span = document.createElement("span");
		span.classList.add("entry");
		span.dataset.timestamp = `${hh}:${mm}:${ss}.${uuuu}`;
		this.element.appendChild(span);
		return span;
	}
	_writeText(str, extraClass) {
		const entry = this._makeEntry();
		if (extraClass) {
			entry.classList.add(extraClass);
		}
		entry.textContent = str + "\n";
	}
	log(str) {
		this._writeText(str);
	}
	error(str) {
		this._writeText(str + "\n" + Error().stack.replace(/^[^\n]+\n/, ""), "error");
	}
	warning(str) {
		this._writeText(str, "warning");
	}
	html(html) {
		const entry = this._makeEntry();
		entry.innerHTML = html;
		entry.innerHTML += "\n";
	}
	clear() {
		this.element.innerText = "";
	}
}

const out = new Logger("output");

class BinaryEncoder {
	static utf8 = new TextEncoder();
	constructor() {
		this.buffer = [];
	}
	pushByte(...b) {
		this.buffer.push(...b);
	}
	pushString(s) {
		const buf = BinaryEncoder.utf8.encode(s);
		this.pushU32(buf.length);
		this.buffer.push(...buf);
	}
	pushU32(v) {
		const buffer = this.buffer;
		for (; v & ~0x7f; v >>>= 7) {
			buffer.push((v & 0x7f) | 0x80);
		}
		buffer.push(v);
	}
	pushI32(v) {
		const buffer = this.buffer;
		for (; (v >> 6) ^ (v >> 7); v >>= 7) {
			buffer.push((v & 0x7f) | 0x80);
		}
		buffer.push(v & 0x7f);
	}
	measuredBlock(cb) {
		const oldBuffer = this.buffer;
		const newBuffer = []
		this.buffer = newBuffer
		cb();
		this.buffer = oldBuffer;
		this.pushU32(newBuffer.length);
		oldBuffer.push(...newBuffer);
	}
	toUint8Array() {
		return new Uint8Array(this.buffer);
	}
}

const Type = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, Vec: 0x7b, FuncRef: 0x70, ExternRef: 0x6f, Func: 0x60, };
const Section = { Type: 1, Function: 3, Export: 7, Code: 10, };
const Export = { Func: 0x00, Table: 0x01, Mem: 0x02, Global: 0x03, };
const OpCode = {
	"i32.const": 0x41,
	"i32.add": 0x6A,
	"i32.sub": 0x6B,
	"local.get": 0x20,
};

class Asssembler {
	constructor() {
		this._encoder = new BinaryEncoder();
	}
	_assembleExpr(expr) {
		const enc = this._encoder;
		if (typeof expr === "number") {
			enc.pushByte(OpCode["i32.const"]);
			enc.pushI32(expr);
		} else if (Array.isArray(expr)) {
			if (typeof expr[0] === "string") {
				switch (expr[0]) {
					case "add1":
						this._assembleExpr(expr[1]);
						this._assembleExpr(1);
						enc.pushByte(OpCode["i32.add"]);
						break;
					case "sub1":
						this._assembleExpr(expr[1])
						this._assembleExpr(1)
						enc.pushByte(OpCode["i32.sub"]);
						break;
					case "zero?":
						this._assembleExpr(expr[1])
						enc.pushByte(0x04, Type.i32);
						this._assembleExpr(0);
						enc.pushByte(0x05);
						this._assembleExpr(1);
						enc.pushByte(0x0B);
						break;
					default:
						throw new Error(`Unknown function: ${expr[0]}`)
				}
			}
		} else {
			throw new Error(`Unknown expression: ${expr}`);
		}
	}
	assembleModule(def) {
		const { functions } = def;
		const enc = this._encoder;

		enc.pushByte(
			0x00, 0x61, 0x73, 0x6D, // magic
			0x01, 0x00, 0x00, 0x00, // version
		);

		const section = (id, cb) => {
			enc.pushByte(id);
			enc.measuredBlock(cb);
		};
		section(Section.Type, () => {
			enc.pushU32(functions.length);
			functions.forEach((func) => {
				enc.pushByte(Type.Func);
				enc.pushU32(func.arg.length);
				enc.pushByte(...func.arg);
				enc.pushU32(func.ret.length);
				enc.pushByte(...func.ret);
			});
		});
		section(Section.Function, () => {
			enc.pushU32(functions.length);
			functions.forEach((_func, i) => {
				enc.pushU32(i)
			});
		});
		section(Section.Export, () => {
			const exports = functions.filter((func) => func.export);
			enc.pushU32(exports.length);
			exports.forEach((func, i) => {
				enc.pushString(func.name);
				enc.pushByte(Export.Func);
				enc.pushU32(i);
			});
		});
		section(Section.Code, () => {
			enc.pushU32(functions.length);
			functions.forEach((func) => {
				enc.measuredBlock(() => {
					enc.pushU32(0); // locals
					this._assembleExpr(func.code);
					enc.pushByte(0x0b); // end
				})
			});
		});
		return enc.toUint8Array();
	}
}

const hexdump = (buffer) => {
	for (let i=0; i < buffer.length; i += 16) {
		const slice = Array.from(buffer.slice(i, i+16));
		const pos = i.toString(16).padStart(8, "0")
		const hex = slice.map((byte, i) => {
			return byte.toString(16).padStart(2, "0") + (i === 7 ? " " : "");
		}).join(" ").padEnd(48);
		const chr = slice.map((byte) => {
			return (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : ".";
		});
		out.log(`${pos}  ${hex}  |${chr.join("")}|`);
	}
}

try {
	out.log("Assembling bytecode...");

	const bytecode = new Asssembler().assembleModule({
		functions: [{
			name: "main",
			export: true,
			arg: [ ],
			ret: [ Type.i32 ],
			code: ["add1", ["zero?", ["sub1", 1]]],
		}],
	});

	hexdump(bytecode);

	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([bytecode], {type: "application/wasm"}));
	link.innerText = "Download bytecode";
	link.download = "a.wasm";
	out.html(link.outerHTML)

	out.log("Compiling module...")
	const module = new WebAssembly.Module(bytecode);

	out.log("Instantiating...")
	const imports = {
		imports: {
			log(arg) {
				out.log(arg);
			},
		},
	};
	const instance = new WebAssembly.Instance(module, imports);

	out.log("Executing `main`...")
	out.log(`=> ${instance.exports.main()}`);
} catch (err) {
	out.error(err);
	throw err;
}
