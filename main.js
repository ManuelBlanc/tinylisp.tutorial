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
	static f64 = new DataView(new ArrayBuffer(8));
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
	pushF64(v) {
		const f64 = BinaryEncoder.f64;
		f64.setFloat64(0, v, true);
		this.buffer.push(
			f64.getUint8(0), f64.getUint8(1), f64.getUint8(2), f64.getUint8(3),
			f64.getUint8(4), f64.getUint8(5), f64.getUint8(6), f64.getUint8(7),
		);
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
	"local.get": 0x20,
	"i32.const": 0x41,
	"f64.const": 0x44,
	"i32.clz": 0x67,
	"i32.ctz": 0x68,
	"i32.popcnt": 0x69,
	"i32.add": 0x6A,
	"i32.sub": 0x6B,
	"i32.mul": 0x6C,
	"i32.div_s": 0x6D,
	"i32.div_u": 0x6E,
	"i32.rem_s": 0x6F,
	"i32.rem_u": 0x70,
	"i32.and": 0x71,
	"i32.or": 0x72,
	"i32.xor": 0x73,
	"i32.shl": 0x74,
	"i32.shr_s": 0x75,
	"i32.shr_u": 0x76,
	"i32.rotl": 0x77,
	"i32.rotr": 0x78,
	"f64.abs": 0x99,
	"f64.neg": 0x9A,
	"f64.ceil": 0x9B,
	"f64.floor": 0x9C,
	"f64.trunc": 0x9D,
	"f64.nearest": 0x9E,
	"f64.sqrt": 0x9F,
	"f64.add": 0xA0,
	"f64.sub": 0xA1,
	"f64.mul": 0xA2,
	"f64.div": 0xA3,
	"f64.min": 0xA4,
	"f64.max": 0xA5,
	"f64.copysign": 0xA6,
};

const i32OpArity = {
	"clz": 1, "ctz": 1, "popcnt": 1,
	"add": 2, "sub": 2, "mul": 2,
	"div_s": 2, "div_u": 2, "rem_s": 2, "rem_u": 2,
	"and": 2, "or": 2, "xor": 2,
	"shl": 2, "shr_s": 2, "rotl": 2, "rotr": 2,
};
const f64OpArity = {
	"abs": 1, "neg": 1, "sqrt": 1, "ceil": 1, "floor": 1, "trunc": 1, "nearest": 1,
	"add": 2, "sub": 2, "mul": 2, "div": 2, "min": 2, "max": 2, "copysign": 2,
}

class Asssembler {
	constructor() {
		this._encoder = new BinaryEncoder();
	}
	_assembleNumber(n) {
		const enc = this._encoder;
		enc.pushByte(OpCode["f64.const"]);
		enc.pushF64(n);
	}
	_assemblePrimitive(op, args) {
		const enc = this._encoder;
		if (f64OpArity[op]) {
			for (let i = 0; i < f64OpArity[op]; ++i) {
				this._assembleExpr(args[i]);
			}
			enc.pushByte(OpCode[`f64.${op}`]);
		} else if (op === "$local") {
			enc.pushByte(OpCode["local.get"]);
			enc.pushU32(args[0]);
		} else {
			switch (op) {
				case "zero?":
					this._assembleExpr(args[0])
					enc.pushByte(0x04, Type.i32);
					this._assembleExpr(0);
					enc.pushByte(0x05);
					this._assembleExpr(1);
					enc.pushByte(0x0B);
					break;
				default:
					throw new Error(`Unknown op: ${op}`)
			}
		}
	}
	_assembleExpr(expr) {
		if (typeof expr === "number") {
			this._assembleNumber(expr);
		} else if (Array.isArray(expr)) {
			if (typeof expr[0] === "string") {
				const [op, ...args] = expr;
				this._assemblePrimitive(op, args);
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
			arg: [ Type.f64 ],
			ret: [ Type.f64 ],
			code: ["mul", 3.14, ["mul", ["$local", 0], ["$local", 0]]],
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
	out.log(`=> ${instance.exports.main(7)}`);
} catch (err) {
	out.error(err);
	throw err;
}
