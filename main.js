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
		const newBuffer = [];
		this.buffer = newBuffer;
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

const Type = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c, Vec: 0x7b, FuncRef: 0x70, ExternRef: 0x6f, Func: 0x60, };
const Section = { Type: 1, Function: 3, Table: 4, Export: 7, Element: 9, Code: 10, };
const Export = { Func: 0x00, Table: 0x01, Mem: 0x02, Global: 0x03, };
const OpCode = new Proxy({
	"loop": 0x03,
	"if": 0x04,
	"else": 0x05,
	"end": 0x0B,
	"br_if": 0x0D,
	"call_indirect": 0x11,
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

class LambdaAssembler {
	constructor(def, module) {
		this.def = def;
		this.module = module;
		this.encoder = new BinaryEncoder();
		this.scopeStack = [new Map()];
		this.base = 0;
		this.top = def.args.length;
		for (const arg of def.args) {
			this._varMake(arg);
		}
		this._assembleExpr(def.code);
	}
	_assert(cond, msg) {
		if (!cond) throw new Error(`Assemble Error: ${msg}`);
	}
	_varSubscope(cb) {
		this.scopeStack.unshift(new Map());
		const oldBase = this.base;
		cb();
		if (this.base > this.top) this.top = this.base;
		this.base = oldBase;
		this.scopeStack.shift();
	}
	_varGet(name) {
		for (const scope of this.scopeStack) {
			const id = scope.get(name);
			if (id !== undefined) {
				return id;
			}
		}
	}
	_varMake(name) {
		this._assert(!this.scopeStack[0].has(name), `Local was already declared in this scope: '${name}'`);
		const id = this.base++;
		this.scopeStack[0].set(name, id);
		return id;
	}
	_assembleNumber(n) {
		this.encoder.pushByte(OpCode["f64.const"]);
		this.encoder.pushF64(n);
	}
	_assembleTaggedValue(id, payload) {
		id = ~id;
		this.encoder.pushByte(OpCode["f64.const"]);
		this.encoder.pushByte(
			payload>>0  & 0xff,
			payload>>8  & 0xff,
			payload>>16 & 0xff,
			payload>>24 & 0xff,
			0xff,0x7f|(id<<7 & 0x80),0xf8|(id>>1 & 0x7),0xff,
		);
	}
	_assembleNil() {
		this._assembleTaggedValue(0, -1);
	}
	_assembleBoolean(v) {
		this._assembleTaggedValue(v ? 2 : 1, -1);
	}
	_assembleFunction(id) {
		this._assembleTaggedValue(3, id);
	}
	_constructBoolean() {
		this.encoder.pushByte(OpCode["if"], Type.f64); // ~20% faster than branchless.
		this._assembleBoolean(true);
		this.encoder.pushByte(OpCode["else"]);
		this._assembleBoolean(false);
		this.encoder.pushByte(OpCode["end"]);
	}
	_constructCheckTruthy() {
		this.encoder.pushByte(
			OpCode["i64.reinterpret_f64"],
			OpCode["i64.const"], 47+1, OpCode["i64.shr_s"],
			OpCode["i32.wrap_i64"],
			OpCode["i32.const"], 0x7f, OpCode["i32.ne"],
		);
	}
	_assembleBuiltin(op, args) {
		const enc = this.encoder;
		if (f64OpArity[op]) {
			for (let i = 0; i < f64OpArity[op]; ++i) {
				this._assembleExpr(args[i]);
			}
			if (op.endsWith(("?"))) {
				enc.pushByte(OpCode[`f64.${op.slice(0, -1)}`]);
				this._constructBoolean();
			} else {
				enc.pushByte(OpCode[`f64.${op}`]);
			}
		} else if (op === "nan?") {
			this._assembleExpr(args[0]);
			enc.pushByte(
				OpCode["i64.reinterpret_f64"],
				OpCode["i64.const"], 47, OpCode["i64.shr_s"],
				OpCode["i32.wrap_i64"],
				OpCode["i32.const"], 0x70, OpCode["i32.eq"],
			);
			this._constructBoolean();
		} else if (op === "id?") {
			this._assembleExpr(args[0]);
			enc.pushByte(OpCode["i64.reinterpret_f64"]);
			this._assembleExpr(args[1]);
			enc.pushByte(OpCode["i64.reinterpret_f64"], OpCode["i64.eq"]);
			this._constructBoolean();
		} else if (op === "if") {
			this._assembleExpr(args[0]);
			this._constructCheckTruthy();
			enc.pushByte(OpCode["if"], Type.f64);
			this._assembleExpr(args[1]);
			enc.pushByte(OpCode["else"]);
			if (args[2] !== undefined) {
				this._assembleExpr(args[2]);
			} else {
				this._assembleNil();
			}
			enc.pushByte(OpCode["end"]);
		} else if (op === "local") {
			const names = Array.isArray(args[0]) ? args[0] : [ args[0] ];
			for (let i = 1; i < args.length; ++i) {
				const name = names[i-1];
				if (name !== undefined) {
					const id = this._varMake(name);
					this._assembleExpr(args[i]);
					enc.pushByte(OpCode["local.set"]);
					enc.pushU32(id);
				} else {
					this._assembleExpr(args[i]);
					enc.pushByte(OpCode["drop"]);
				}
			}
			this._assembleNil();
		} else if (op == "set!") {
			this._assembleExpr(args[1]);
			const id = this._varGet(args[0]);
			this._assert(id !== undefined, `Access to undeclared local: '${args[0]}'`);
			enc.pushByte(OpCode["local.tee"]);
			enc.pushU32(id);
		} else if (op === "do") {
			if (args.length > 0) {
				this._varSubscope(() => {
					let i = 0;
					for (; i < args.length-1; ++i) {
						this._assembleExpr(args[i]);
						enc.pushByte(OpCode["drop"]);
					}
					this._assembleExpr(args[i]);
				});
			} else {
				this._assembleNil();
			}
		} else if (op === "function") {
			const id = this.module.pushFunction({
				export: false,
				args: args[0],
				code: args[1],
			});
			this._assembleFunction(id);
		} else {
			throw new Error(`Unknown op: ${op}`);
		}
	}
	_assembleAccess(name) {
		const id = this._varGet(name);
		this._assert(id !== undefined, `Access to undeclared local: '${name}'`);
		this.encoder.pushByte(OpCode["local.get"]);
		this.encoder.pushU32(id);
	}
	_assembleCall(expr) {
		const enc = this.encoder;
		for (let i = 1; i < expr.length; ++i) {
			this._assembleExpr(expr[i]);
		}
		this._assembleExpr(expr[0]);
		enc.pushByte(OpCode["i64.reinterpret_f64"], OpCode["i32.wrap_i64"]);
		enc.pushByte(OpCode["call_indirect"]);
		enc.pushU32(this.module.useArity(expr.length - 1));
		enc.pushByte(0);
	}
	_assembleExpr(expr) {
		const type = typeof expr;
		if (type === "number") {
			this._assembleNumber(expr);
		} else if (type === "boolean") {
			this._assembleBoolean(expr);
		} else if (type === "string") {
			this._assembleAccess(expr);
		} else if (expr === null) {
			this._assembleNil();
		} else if (Array.isArray(expr)) {
			if (expr.length === 0) {
				this._assembleNil();
				return;
			}
			if (typeof expr[0] === "string") {
				const varId = this._varGet(expr[0]);
				if (varId === undefined) {
					const [op, ...args] = expr;
					this._assembleBuiltin(op, args);
					return;
				}
			}
			this._assembleCall(expr);
		} else {
			throw new Error(`Unknown expression: ${expr}`);
		}
	}
}

class ModuleAssembler {
	constructor() {
		this.functions = [];
		this.arityMap = new Map();
		this.arityCount = 0;
	}
	useArity(n) {
		let id = this.arityMap.get(n);
		if (id !== undefined) {
			return id;
		} else {
			id = this.arityCount++
			this.arityMap.set(n, id);
			return id;
		}
	}
	pushFunction(def) {
		const asm = new LambdaAssembler(def, this);
		this.functions.push(asm);
		this.useArity(def.args.length);
		return this.functions.length - 1;
	}
	assemble() {
		const functions = this.functions;
		const enc = new BinaryEncoder();
		enc.pushByte(
			0x00, 0x61, 0x73, 0x6D, // magic
			0x01, 0x00, 0x00, 0x00, // version
		);
		const section = (id, cb) => {
			enc.pushByte(id);
			enc.measuredBlock(cb);
		};
		section(Section.Type, () => {
			enc.pushU32(this.arityMap.size);
			for (const [arity, _] of this.arityMap) {
				enc.pushByte(Type.Func);
				enc.pushU32(arity);
				for (let i = 0; i < arity; ++i) {
					enc.pushByte(Type.f64);
				}
				enc.pushByte(1, Type.f64);
			}
		});
		section(Section.Function, () => {
			enc.pushU32(functions.length);
			for (const func of functions) {
				enc.pushU32(this.arityMap.get(func.def.args.length));
			}
		});
		section(Section.Table, () => {
			enc.pushU32(1);
			enc.pushByte(Type.FuncRef, 0x00);
			enc.pushU32(functions.length);
		});
		section(Section.Export, () => {
			let exportedCount = 0;
			for (const func of functions) {
				if (func.def.export) exportedCount++;
			}
			enc.pushU32(exportedCount);
			functions.forEach((func, i) => {
				if (func.def.export) {
					enc.pushString(func.def.name);
					enc.pushByte(Export.Func);
					enc.pushU32(i);
				}
			});
		});
		section(Section.Element, () => {
			enc.pushU32(1);
			enc.pushByte(0, OpCode["i32.const"], 0, OpCode["end"]);
			enc.pushU32(functions.length);
			for (let i = 0; i < functions.length; ++i) {
				enc.pushU32(i);
			}
		});
		section(Section.Code, () => {
			enc.pushU32(functions.length);
			for (const func of functions) {
				enc.measuredBlock(() => {
					const localCount = func.top - func.def.args.length;
					enc.pushByte(1);
					enc.pushU32(localCount);
					enc.pushByte(Type.f64);
					enc.append(func.encoder);
					enc.pushByte(OpCode["end"]);
				});
			}
		});
		this.bytecode = enc.toUint8Array();
		this.module = new WebAssembly.Module(this.bytecode);
		this.instance = new WebAssembly.Instance(this.module);
		return this.instance.exports.main;
	}
}

const hexdump = (buffer) => {
	for (let i=0; i < buffer.length; i += 16) {
		const slice = Array.from(buffer.slice(i, i+16));
		const pos = i.toString(16).padStart(8, "0");
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
		return `(${expr.map(e => formatCode(e)).join(" ")})`;
	} else {
		throw new Error(`Do not know how to pretty print: ${expr}`);
	}
};

const showBytecodeLink = (bytecode) => {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([bytecode], {type: "application/wasm"}));
	link.innerText = "Download bytecode";
	link.download = "a.wasm";
	out.html(link.outerHTML);
};

let _testCount = 0;
const runTest = (code, expected, ...args) => {
	out.log(`TEST ${(++_testCount).toString().padStart(3,"0")}: ${expected.toString().padStart(8)} == ${formatCode(code)}`);
	const asmMod = new ModuleAssembler();
	let myErr, result;
	try {
		asmMod.pushFunction({ name: "main", export: true, args: ["$1"], code });
		const main = asmMod.assemble();
		result = main(...args);
		if (isNaN(expected) ? !isNaN(result) : result !== expected) {
			myErr = new Error();
		}
	} catch (err) {
		if (!(expected instanceof Error) || -1 === err.message.search(expected.message)) {
			myErr = result = err
		}
	}
	if (myErr) {
		if (asmMod.bytecode) {
			showBytecodeLink(asmMod.bytecode);
			hexdump(asmMod.bytecode);
		}
		myErr.message = `Test failed. Expected '${expected}', but got '${result}'`
		throw myErr;
	}
};

const formatSI = (t) => {
	for (let i = -1; i < 5; ++i) {
		if (t >= 1) {
			return `${t.toFixed(3)}${"munpf".charAt(i)}s`;
		}
		t *= 1000;
	}
	return '0.000 s';
};

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
	out.log(`BENCHMARK: ${label}  =>  ${results.join("  ")} :: ${formatSI(avg)}`);
};

const benchmark = (code) => {
	const asmMod = new ModuleAssembler();
	asmMod.pushFunction({
		name: "main",
		export: true,
		args: ["$1"],
		code,
	});
	_benchmark(formatCode(code), asmMod.assemble());
};

const testSuite = () => {
	out.log("Running test suite...")
	runTest(5, 5)
	runTest(["add", 1, 1], 2)
	runTest("$1", 3.14, 3.14)
	runTest(["add", 5, ["add", 2, 3]], 10)
	runTest(["add", 5, ["mul", 2, 3]], 11)
	runTest(true, NaN);
	runTest(false, NaN);
	runTest(null, NaN);
	runTest(["div", 0, 0], NaN);
	runTest(["if", true, 10, 0], 10)
	runTest(["if", false, 10, 0], 0)
	runTest(["if", null, 10, 0], 0)
	runTest(["if", 42, 10, 0], 10)
	runTest(["if", NaN, 10, 0], 10)
	runTest(["if", ["sub", true, null], ["add", 1, 1], null], 2)
	runTest(["if", ["eq?", 0, -0], 10, 0], 10)
	runTest(["if", ["lt?", -1, 1], 10, 0], 10)
	runTest(["if", ["gt?", 1, -1], 10, 0], 10)
	runTest(["if", ["ne?", 1, -1], 10, 0], 10)
	runTest(["if", ["id?", true, true], 10, 0], 10)
	runTest(["if", ["id?", false, false], 10, 0], 10)
	runTest(["if", ["id?", null, null], 10, 0], 10)
	runTest(["if", ["id?", NaN, NaN], 10, 0], 10)
	runTest(["if", ["id?", true, false], 10, 0], 0)
	runTest(["if", ["id?", true, null], 10, 0], 0)
	runTest(["if", ["id?", false, null], 10, 0], 0)
	runTest(["if", ["id?", NaN, null], 10, 0], 0)
	runTest(["if", ["id?", 0, -0], 10, 0], 0)
	runTest(["if", ["nan?", 0], 10, 0], 0)
	runTest(["if", ["nan?", false], 10, 0], 0)
	runTest(["if", ["nan?", true], 10, 0], 0)
	runTest(["if", ["nan?", null], 10, 0], 0)
	runTest(["if", ["nan?", 1], 10, 0], 0)
	runTest(["if", ["nan?", ["div", 0, 0]], 10, 0], 10)
	runTest(["if", ["if", true, false, true], true, 0], 0)
	runTest(["do", 1, 2, 3], 3)
	runTest(["do", ["local", "a", 1], "a"], 1)
	runTest(["do", ["local", "a", 1], ["add", "a", "a"]], 2)
	runTest(["do", ["local", "a", 3], ["local", "b", 5], ["sub", "a", "b"]], -2)
	runTest(["do", ["local", "a", 1], ["do", ["local", "a", 2], "a"]], 2)
	runTest(["do", ["local", "a", 1], ["do", ["local", "a", 2]], "a"], 1)
	runTest(["do", ["local", ["a", "b"], 3, 5], ["sub", "a", "b"]], -2)
	runTest(["do", ["local", "a", 1], ["set!", "a", 2], "a"], 2)
	runTest(["do", ["local", "a", 1], ["do", ["local", "a", 2], ["set!", "a", 3]], "a"], 1)
	runTest(["function", ["a", "b"], "a"], NaN)
	runTest(["do", ["local", "a", ["function", ["x", "y"], "y"]], "a"], NaN)
	runTest(["do", ["local", "a", ["function", ["x", "y"], ["sub", "x", "y"]]], ["a", 5, 3]], 2)
	runTest([["function", ["a", "b"], "a"], 10, 0], 10)
	runTest([["function", ["a", "b"], "b"], 10, 0], 0)
	runTest([["function", ["f"], "f"], ["function", ["x"], 100]], NaN)
	runTest([["function", ["f"], ["f"]], ["function", [], 100]], 100)
	runTest([["function", ["f", "x"], ["f", ["mul", 2, "x"]]], ["function", ["x"], ["add", "x", 100]], 1], 102)
	runTest(["do",
		["local", "square", ["function", ["x"], ["mul", "x", "x"], "x"]],
		["add", ["square", 3], ["square", 4]],
	], 25);
	runTest([["function", ["f", "x"], ["f", "f", "x"]],
		["function", ["f", "x"], "x"],
		10,
	], 10);
	runTest([["function", ["f", "x"], ["f", "f", "x"]],
		["function", ["fact", "i"], ["if", ["le?", "i", 1], 1, ["mul", "i", ["fact", "fact", ["sub", "i", 1]]]]],
		10,
	], 3628800);
	// At the end to make debugging easier.
	runTest(["do", ["local", ["a", "a"], 3, 5], ["sub", "a", "b"]], Error("Local was already declared"))
	runTest(["do", ["local", "a", 3], ["local", "a", 5], "a"], Error("Local was already declared"))
	runTest(["do", ["local", "a", 3], "b"], Error("Access to undeclared local"))
	runTest(["do", ["do", ["local", "a", 3]], "a"], Error("Access to undeclared local"))
	runTest(["set!", "a", 3], Error("Access to undeclared local"))
	out.log("All tests passed!")
}

testSuite();
//benchmark(["nan?", 42])
//_benchmark("control.js", () => 0)
//benchmark(0)
//benchmark(["do", ["local", ["a", "b"], 3, 5], ["sub", "a", "b"]])
//benchmark(["nan?", NaN])
//benchmark(["add", 1, 1])

class Parser {
	constructor() {
	}
	_assert(cond) {
		if (!cond) {
			this.error = new Error(message);
			throw this.error;
		}
	}
	_skip(n) {
		this.text = this.text.slice(n).trim();
	}
	_parse() {
		const prim = Parser.PRIMITIVE.exec(this.text);
		if (prim) {
			this._skip(prim[0].length);
			switch (prim[0]) {
				case "true": return true;
				case "false": return false;
				case "nil": return null;
			}
		}
		const ident = Parser.IDENT.exec(this.text);
		if (ident) {
			this._skip(ident[0].length);
			return ident[0];
		}
		const num = Parser.NUMBER.exec(this.text);
		if (num) {
			this._skip(num[0].length);
			return parseFloat(num[0]);
		}
		if (this.text[0] === "(") {
			this._skip(1);
			const list = [];
			while (true) {
				this._skip(0);
				const char = this.text[0];
				this._assert(char !== undefined, `Unterminated list`);
				if (char === ")") break;
				list.push(this._parse());
			}
			this._skip(1);
			return list;
		}
		this._assert(false, `Could not parse: '${this.text}'`);
	}
	parse(text) {
		this.text = text;
		this._skip(0); // Trim.
		try {
			return this._parse();
		} catch (err) {
			this.error = err;
		}
	}
}
Parser.PRIMITIVE = /^(?:true|false|nil)\b/;
Parser.IDENT = /^[a-z?+*/%&@#$=~|<>,.;:_-][0-9a-z?+*/%&@#$=~|<>,.;:_-]*/i;
Parser.NUMBER = /^[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;

class Repl {
	constructor(id, out) {
		this.element =  document.getElementById(id);
		this.out = out;
		this.parser = new Parser();
		out.scrollToBottom();
		input.focus();
		input.addEventListener("keydown", this.onKeyDown.bind(this));
		this.history = [""];
		this.historyIndex = 0;
	}
	onKeyDown(evt) {
		if (evt.code === "Enter" && input.value.trim() !== "") {
			const text = input.value;
			this.history[(this.historyIndex = this.history.length) - 1] = text;
			this.history.push("")
			input.value = "";
			input.focus();
			try {
				if (text === ".clear") {
					this.out.clear();
				} else {
					const code = this.parser.parse(text);
					if (code === undefined) {
						this.out.error(code.error);
					} else {
						this.out.log(`λ> ${formatCode(code)}`);
						const asmMod = new ModuleAssembler();
						asmMod.pushFunction({
							name: "main",
							export: true,
							args: [],
							code,
						});
						const main = asmMod.assemble();
						this.out.log(main());
					}
				}
			} catch (err) {
				this.out.error(err);
				throw err;
			} finally {
				this.out.scrollToBottom();
			}
			evt.preventDefault();
		} else if (evt.code === "ArrowUp") {
			if (this.historyIndex > 0) {
				this.history[this.historyIndex] = this.element.value;
				this.element.value = this.history[--this.historyIndex];
			}
			evt.preventDefault();
		} else if (evt.code === "ArrowDown") {
			if (this.historyIndex < this.history.length-1) {
				this.history[this.historyIndex] = this.element.value;
				this.element.value = this.history[++this.historyIndex];
			}
			evt.preventDefault();
		} else if (evt.ctrlKey) { // emacs stuff
			const element = this.element;
			switch (evt.code) {
				case "KeyE":
					element.selectionStart = element.selectionEnd = element.value.length;
					break;
				case "KeyU":
					element.value = element.value.slice(element.selectionStart); // Fallthrough.
				case "KeyA":
					element.selectionStart = element.selectionEnd = 0;
					break;
				case "KeyK":
					element.value = element.value.slice(0, element.selectionStart);
					break;
				case "KeyD":
					const i = element.selectionStart;
					element.value = element.value.slice(0, i) + element.value.slice(i + 1);
					element.selectionStart = element.selectionEnd = i;
					break;
				case "ArrowRight":
				case "ArrowLeft":
				case "KeyZ":
				case "KeyX":
				case "KeyC":
				case "KeyV":
					return; // Keep default behaviour.
			}
			evt.preventDefault();
		}
	}
}

const repl = new Repl("input", out);
