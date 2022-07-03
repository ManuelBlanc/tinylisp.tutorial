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
	scrollToBottom() {
		this.element.scrollTo(0, this.element.scrollHeight);
	}
}

const out = new Logger("output");

class BinaryEncoder {
	constructor() {
		this.buffer = [];
	}
	append(enc) {
		this.buffer.push(...enc.buffer);
	}
	pushByte(...b) {
		this.buffer.push(...b);
	}
	pushString(s) {
		ASSERT(typeof s === "string");
		const buf = BinaryEncoder.utf8.encode(s);
		this.pushU32(buf.length);
		this.buffer.push(...buf);
	}
	pushU32(v) {
		ASSERT(Number.isInteger(v) && v >= 0 && v < 2**32);
		const buffer = this.buffer;
		for (; v & ~0x7f; v >>>= 7) {
			buffer.push((v & 0x7f) | 0x80);
		}
		buffer.push(v);
	}
	pushI32(v) {
		ASSERT(Number.isInteger(v) && v >= -(2**31) && v < 2**31);
		const buffer = this.buffer;
		for (; (v >> 6) ^ (v >> 7); v >>= 7) {
			buffer.push((v & 0x7f) | 0x80);
		}
		buffer.push(v & 0x7f);
	}
	pushF64(v) {
		ASSERT(typeof v === "number");
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
BinaryEncoder.utf8 = new TextEncoder();
BinaryEncoder.f64 = new DataView(new ArrayBuffer(8));

class Scope {
	constructor(parent) {
		this.parent = parent
		this.vars = new Map()
		this.base = parent ? parent.base : 0;
		this.max = this.base;
	}
	subscope(cb) {
		const sub = new Scope(this);
		cb(sub)
		this.max = Math.max(this.max, sub.max);
	}
	get(name) {
		const id = this.vars.get(name);
		if (id !== undefined) { // Fast path.
			return id;
		} else if (this.parent) {
			return this.parent.get(name);
		}
	}
	make(name) {
		const id = this.base++;
		this.max++;
		this.vars.set(name, id);
		return id;
	}
	canMake(name) {
		return !this.vars.has(name);
	}
}

const Type = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, Vec: 0x7b, FuncRef: 0x70, ExternRef: 0x6f, Func: 0x60, };
const Section = { Type: 1, Function: 3, Export: 7, Code: 10, };
const Export = { Func: 0x00, Table: 0x01, Mem: 0x02, Global: 0x03, };
const OpCode = new Proxy({
	"loop": 0x03,
	"if": 0x04,
	"else": 0x05,
	"end": 0x0B,
	"br_if": 0x0D,
	"drop": 0x1A,

	"local.get": 0x20,
	"local.set": 0x21,
	"local.tee": 0x22,

	"i32.const": 0x41,
	"i64.const": 0x42,
	"f64.const": 0x44,

	"i64.reinterpret_f64": 0xBD,
	"f64.reinterpret_i64": 0xBF,
	"i32.wrap_i64": 0xA7,
	"i64.extend_i32_u": 0xAD,

	"i32.eqz": 0x45,
	"i32.eq": 0x46,
	"i32.ne": 0x47,

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

	"i64.eqz": 0x50,
	"i64.eq": 0x51,
	"i64.ne": 0x52,
	"i64.or": 0x84,
	"i64.xor": 0x85,
	"i64.shl": 0x86,
	"i64.shr_s": 0x87,
	"i64.rotr": 0x8A,

	"f64.eq": 0x61,
	"f64.ne": 0x62,
	"f64.lt": 0x63,
	"f64.gt": 0x64,
	"f64.le": 0x65,
	"f64.ge": 0x66,

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
}, {
	get(lut, op) {
		const code = lut[op];
		if (!code) {
			throw new Error(`Operation '${op}' not defined.`);
		}
		return code;
	},
});

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
	"eq?": 2, "ne?": 2, "lt?": 2, "gt?": 2, "le?": 2, "ge?": 2,
};

class LispAssembler {
	constructor() {
		this._encoder = new BinaryEncoder();
	}
	_assert(cond, msg) {
		if (!cond) throw new Error(`Assemble Error: ${msg}`);
	}
	_assembleNumber(n) {
		const enc = this._encoder;
		enc.pushByte(OpCode["f64.const"]);
		enc.pushF64(n);
	}
	_assemblePrimitive(id) {
		id = ~id;
		const enc = this._encoder;
		enc.pushByte(OpCode["f64.const"]);
		enc.pushByte(0xff,0xff,0xff,0xff,0xff,0x7f|(id<<7 & 0x80),0xf8|(id>>1 & 0x7),0xff);
	}
	_assembleNil() {
		this._assemblePrimitive(0);
	}
	_assembleBoolean(v) {
		this._assemblePrimitive(v ? 2 : 1);
	}
	_constructBoolean() {
		const enc = this._encoder;
		enc.pushByte(OpCode["if"], Type.f64); // ~20% faster than branchless.
		this._assembleBoolean(true);
		enc.pushByte(OpCode["else"]);
		this._assembleBoolean(false);
		enc.pushByte(OpCode["end"]);
	}
	_constructCheckTruthy() {
		this._encoder.pushByte(
			OpCode["i64.reinterpret_f64"],
			OpCode["i64.const"], 47+1, OpCode["i64.shr_s"],
			OpCode["i32.wrap_i64"],
			OpCode["i32.const"], 0x7f, OpCode["i32.ne"],
		);
	}
	_assembleBuiltin(op, args, scope) {
		const enc = this._encoder;
		if (f64OpArity[op]) {
			for (let i = 0; i < f64OpArity[op]; ++i) {
				this._assembleExpr(args[i], scope);
			}
			if (op.endsWith(("?"))) {
				enc.pushByte(OpCode[`f64.${op.slice(0, -1)}`]);
				this._constructBoolean();
			} else {
				enc.pushByte(OpCode[`f64.${op}`]);
			}
		} else if (op === "zero?") {
			this._assembleExpr(args[0], scope);
			this._assembleNumber(0);
			enc.pushByte(OpCode["f64.eq"]);
			this._constructBoolean();
		} else if (op === "nan?") {
			this._assembleExpr(args[0], scope);
			enc.pushByte(
				OpCode["i64.reinterpret_f64"],
				OpCode["i64.const"], 47, OpCode["i64.shr_s"],
				OpCode["i32.wrap_i64"],
				OpCode["i32.const"], 0x70, OpCode["i32.eq"],
			);
			this._constructBoolean();
		} else if (op === "id?") {
			this._assembleExpr(args[0], scope);
			enc.pushByte(OpCode["i64.reinterpret_f64"]);
			this._assembleExpr(args[1], scope);
			enc.pushByte(OpCode["i64.reinterpret_f64"], OpCode["i64.eq"]);
			this._constructBoolean();
		} else if (op === "if") {
			this._assembleExpr(args[0], scope);
			this._constructCheckTruthy();
			enc.pushByte(OpCode["if"], Type.f64);
			this._assembleExpr(args[1], scope);
			enc.pushByte(OpCode["else"]);
			if (args[2] !== undefined) {
				this._assembleExpr(args[2], scope);
			} else {
				this._assembleNil();
			}
			enc.pushByte(OpCode["end"]);
		} else if (op === "local") {
			const names = Array.isArray(args[0]) ? args[0] : [ args[0] ];
			for (let i = 1; i < args.length; ++i) {
				const name = names[i-1];
				if (name !== undefined) {
					this._assert(scope.canMake(name), `Local was already declared in this scope: '${name}'`);
					const id = scope.make(name);
					this._assembleExpr(args[i], scope);
					enc.pushByte(OpCode["local.set"]);
					enc.pushU32(id);
				} else {
					this._assembleExpr(args[i], scope);
					enc.pushByte(OpCode["drop"]);
				}
			}
			this._assembleNil();
		} else if (op == "set!") {
			this._assembleExpr(args[1], scope);
			const id = scope.get(args[0]);
			this._assert(id !== undefined, `Write to undeclared local: '${name}'`)
			enc.pushByte(OpCode["local.tee"]);
			enc.pushU32(id);
		} else if (op === "do") {
			if (args.length > 0) {
				scope.subscope((sub) => {
					let i = 0;
					for (; i < args.length-1; ++i) {
						this._assembleExpr(args[i], sub);
						enc.pushByte(OpCode["drop"]);
					}
					this._assembleExpr(args[i], sub);
				})
			} else {
				this._assembleNil();
			}
		} else {
			throw new Error(`Unknown op: ${op}`)
		}
	}
	_assembleAccess(name, scope) {
		const enc = this._encoder;
		const idx = scope.get(name);
		this._assert(idx !== undefined, `Read from undeclared local: '${name}'`) 
		enc.pushByte(OpCode["local.get"]);
		enc.pushU32(idx);
	}
	_assembleExpr(expr, scope) {
		const type = typeof expr
		if (type === "number") {
			this._assembleNumber(expr);
		} else if (type === "boolean") {
			this._assembleBoolean(expr);
		} else if (type === "string") {
			this._assembleAccess(expr, scope);
		} else if (expr === null) {
			this._assembleNil();
		} else if (Array.isArray(expr)) {
			if (typeof expr[0] === "string") {
				const [op, ...args] = expr;
				this._assembleBuiltin(op, args, scope);
			}
		} else {
			throw new Error(`Unknown expression: ${expr}`);
		}
	}
	_assembleFunction(func) {
		const oldEnc = this._encoder;
		this._encoder = new BinaryEncoder()
		const scope = new Scope();
		const arity = func.arg.length;
		for (let i = 0; i < arity; ++i) {
			scope.make(`$${i + 1}`);
		}
		this._assembleExpr(func.code, scope);
		oldEnc.measuredBlock(() => {
			const localCount = scope.max - arity;
			oldEnc.pushU32(localCount);
			for (let i = 0; i < localCount; ++i) {
				oldEnc.pushByte(1, Type.f64);
			}
			oldEnc.append(this._encoder)
			oldEnc.pushByte(OpCode["end"]);
		})
		this._encoder = oldEnc;
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
				this._assembleFunction(func);
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

const numberFmt = new Intl.NumberFormat('en-US');
const formatCode = (expr) => {
	const type = typeof expr;
	if (type === "boolean") {
		return expr.toString();
	} else if (expr === null) {
		return "nil";
	} else if (type === "number") {
		return numberFmt.format(expr);
	} else if (type === "string") {
		return expr;
	} else if (Array.isArray(expr)) {
		return `(${expr[0]}${expr.slice(1).map(e => ` ${formatCode(e)}`).join("")})`;
	} else {
		throw new Error(`Do not know how to pretty print: ${expr}`);
	}
};

const showBytecodeLink = (bytecode) => {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([bytecode], {type: "application/wasm"}));
	link.innerText = "Download bytecode";
	link.download = "a.wasm";
	out.html(link.outerHTML)
};

const assemble = (code) => {
	return new LispAssembler().assembleModule({
		functions: [{
			name: "main",
			export: true,
			arg: [ Type.f64 ],
			ret: [ Type.f64 ],
			code,
		}],
	});
};

const compile = (bytecode) => {
	const module = new WebAssembly.Module(bytecode);
	const instance = new WebAssembly.Instance(module);
	return instance.exports.main;
}

let _testCount = 0;
const runTest = (code, expected, ...args) => {
	out.log(`TEST ${(++_testCount).toString().padStart(3,"0")}: ${expected.toString().padStart(8)} == ${formatCode(code)}`);
	let bytecode, result;
	try {
		bytecode = assemble(code);
		const main = compile(bytecode);
		result = main(...args);
		if (isNaN(expected) ? isNaN(result) : result === expected) {
			return true;
		}
	} catch (e) {
		if (expected instanceof Error && -1 !== e.message.search(expected.message)) {
			return true;
		}
		result = e;
	}
	if (bytecode) {
		showBytecodeLink(bytecode);
		hexdump(bytecode);
	}
	throw new Error(`Test failed. Expected '${expected}', but got '${result}'`);
}

const formatSI = (t) => {
	for (let i = -1; i < 5; ++i) {
		if (t >= 1) {
			return `${t.toFixed(3)}${"munpf".charAt(i)}s`;
		}
		t *= 1000;
	}
	return '0.000 s'
}

const _benchmark = (label, chunk) => {
	const results = [];
	let avg = 0;
	for (let sets = 0; sets < 5; ++sets) {
		const t0 = performance.now();
		for (let reps = 0; reps < 10000000; ++reps) {
			chunk(0);
		}
		const t1 = performance.now();
		const dt = (t1 - t0) / 10000000;
		avg += dt;
		results.push(formatSI(dt));
	}
	avg /= results.length;
	out.log(`BENCHMARK: ${label}  =>  ${results.join("  ")} :: ${formatSI(avg)}`)
};

const benchmark = (code) => {
	_benchmark(formatCode(code), compile(assemble(code)));
}

const testSuite = () => {
	runTest(5, 5)
	runTest(["add", 1, 1], 2)
	runTest("$1", 3.14, 3.14)
	runTest(["add", 5, ["add", 2, 3]], 10)
	runTest(["add", 5, ["mul", 2, 3]], 11)
	runTest(true, NaN);
	runTest(false, NaN);
	runTest(null, NaN);
	runTest(["div", 0, 0], NaN);
	runTest(["if", true, 100, 0], 100)
	runTest(["if", false, 100, 0], 0)
	runTest(["if", null, 100, 0], 0)
	runTest(["if", 42, 100, 0], 100)
	runTest(["if", NaN, 100, 0], 100)
	runTest(["if", ["sub", true, null], ["add", 1, 1], null], 2)
	runTest(["if", ["zero?", 0], 100, 0], 100)
	runTest(["if", ["zero?", -0], 100, 0], 100)
	runTest(["if", ["zero?", 42], 100, 0], 0)
	runTest(["if", ["eq?", 0, -0], 100, 0], 100)
	runTest(["if", ["lt?", -1, 1], 100, 0], 100)
	runTest(["if", ["gt?", 1, -1], 100, 0], 100)
	runTest(["if", ["ne?", 1, -1], 100, 0], 100)
	runTest(["if", ["id?", true, true], 100, 0], 100)
	runTest(["if", ["id?", false, false], 100, 0], 100)
	runTest(["if", ["id?", null, null], 100, 0], 100)
	runTest(["if", ["id?", NaN, NaN], 100, 0], 100)
	runTest(["if", ["id?", true, false], 100, 0], 0)
	runTest(["if", ["id?", true, null], 100, 0], 0)
	runTest(["if", ["id?", false, null], 100, 0], 0)
	runTest(["if", ["id?", NaN, null], 100, 0], 0)
	runTest(["if", ["id?", 0, -0], 100, 0], 0)
	runTest(["if", ["nan?", 0], 100, 0], 0)
	runTest(["if", ["nan?", false], 100, 0], 0)
	runTest(["if", ["nan?", true], 100, 0], 0)
	runTest(["if", ["nan?", null], 100, 0], 0)
	runTest(["if", ["nan?", 1], 100, 0], 0)
	runTest(["if", ["nan?", ["div", 0, 0]], 100, 0], 100)
	runTest(["if", ["if", true, false, true], true, 0], 0)
	runTest(["do", 1, 2, 3], 3)
	runTest(["do", ["local", "a", 1], "a"], 1)
	runTest(["do", ["local", "a", 1], ["add", "a", "a"]], 2)
	runTest(["do", ["local", "a", 3], ["local", "b", 5], ["sub", "a", "b"]], -2)
	runTest(["do", ["local", "a", 1], ["do", ["local", "a", 2], "a"]], 2)
	runTest(["do", ["local", "a", 1], ["do", ["local", "a", 2]], "a"], 1)
	runTest(["do", ["local", ["a", "b"], 3, 5], ["sub", "a", "b"]], -2)
	runTest(["do", ["local", ["a", "a"], 3, 5], ["sub", "a", "b"]], Error("Local was already declared"))
	runTest(["do", ["local", "a", 3], ["local", "a", 5], "a"], Error("Local was already declared"))
	runTest(["do", ["local", "a", 3], "b"], Error("Read from undeclared local"))
	runTest(["do", ["do", ["local", "a", 3]], "a"], Error("Read from undeclared local"))
	runTest(["set!", "a", 3], Error("Write to undeclared local"))
	runTest(["do", ["local", "a", 1], ["set!", "a", 2], "a"], 2)
	runTest(["do", ["local", "a", 1], ["do", ["local", "a", 2], ["set!", "a", 3]], "a"], 1)
	out.log("All tests passed!")
}

try {
	testSuite();
	//benchmark(["zero?", 0])
	//benchmark(["zero?", 42])
	//benchmark(["nan?", 42])
	//_benchmark("control.js", () => 0)
	//benchmark(0)
	//benchmark(["do", ["local", ["a", "b"], 3, 5], ["sub", "a", "b"]])
	//benchmark(["nan?", NaN])
	//benchmark(["add", 1, 1])

} catch (err) {
	out.error(err);
	throw err;
} finally {
	out.scrollToBottom();
}
