// Tiny stack VM, second draft — an interpreter for make.fun's tiny stack ISA v1.
// One invocation serves a whole set: each /input/<id>/ holds program.bin and
// input.bin, and this program answers with /output/<id>/stdout.bin together
// with /output/<id>/exit.txt. Node 22, standard library only, no clock,
// no randomness, no environment reads, so two runs agree byte for byte.
import * as fs from 'node:fs';
import * as path from 'node:path';

// Per opcode: how many immediate bytes follow it, how many stack values it
// consumes, and how many it leaves behind. Anything missing here is an
// unknown opcode and traps.
const META: Array<[number, number, number] | undefined> = [];
function define(code: number, imm: number, take: number, give: number): void {
  META[code] = [imm, take, give];
}
define(0x00, 0, 0, 0);
define(0x01, 1, 0, 1);
define(0x02, 4, 0, 1);
define(0x03, 0, 1, 0);
define(0x04, 0, 1, 2);
define(0x05, 0, 2, 2);
define(0x06, 0, 2, 3);
define(0x07, 0, 3, 3);
for (const code of [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19, 0x1a, 0x1c, 0x1d, 0x1e, 0x20, 0x21, 0x22]) define(code, 0, 2, 1);
define(0x17, 0, 1, 1);
define(0x1b, 0, 1, 1);
define(0x30, 2, 0, 0);
define(0x31, 2, 1, 0);
define(0x32, 2, 1, 0);
define(0x33, 2, 0, 0);
define(0x34, 0, 0, 0);
define(0x40, 0, 1, 1);
define(0x41, 0, 2, 0);
define(0x50, 0, 1, 0);
define(0x51, 0, 1, 0);
define(0x52, 0, 0, 1);
define(0x53, 0, 1, 0);

const text = new TextEncoder();

function execute(prog: Uint8Array, input: Uint8Array): { bytes: Uint8Array; exit: number } {
  const stack = new Int32Array(256);
  const frames = new Int32Array(64);
  const cells = new Int32Array(256);
  const bytes = new Uint8Array(65536);
  let top = 0;
  let depth = 0;
  let pc = 0;
  let steps = 0;
  let written = 0;
  let read = 0;
  const result = (exit: number): { bytes: Uint8Array; exit: number } => ({ bytes: bytes.slice(0, written), exit });
  for (;;) {
    if (steps === 1000000) return result(10);
    if (pc < 0 || pc >= prog.length) return result(9);
    const op = prog[pc];
    const meta = META[op];
    if (meta === undefined) return result(5);
    const [imm, take, give] = meta;
    if (pc + imm >= prog.length) return result(9);
    steps += 1;
    const next = pc + 1 + imm;
    if (top < take) return result(2);
    if (top - take + give > 256) return result(3);
    pc = next;
    if (op === 0x00) return result(0);
    if (op === 0x01) {
      stack[top++] = (prog[next - 1] << 24) >> 24;
      continue;
    }
    if (op === 0x02) {
      stack[top++] = prog[next - 4] | (prog[next - 3] << 8) | (prog[next - 2] << 16) | (prog[next - 1] << 24);
      continue;
    }
    if (op === 0x03) {
      top -= 1;
      continue;
    }
    if (op === 0x04) {
      stack[top] = stack[top - 1];
      top += 1;
      continue;
    }
    if (op === 0x05) {
      const tmp = stack[top - 1];
      stack[top - 1] = stack[top - 2];
      stack[top - 2] = tmp;
      continue;
    }
    if (op === 0x06) {
      stack[top] = stack[top - 2];
      top += 1;
      continue;
    }
    if (op === 0x07) {
      const tmp = stack[top - 3];
      stack[top - 3] = stack[top - 2];
      stack[top - 2] = stack[top - 1];
      stack[top - 1] = tmp;
      continue;
    }
    if (op === 0x17) {
      stack[top - 1] = (-stack[top - 1]) | 0;
      continue;
    }
    if (op === 0x1b) {
      stack[top - 1] = ~stack[top - 1];
      continue;
    }
    if (op >= 0x10 && op <= 0x22) {
      const b = stack[top - 1];
      const a = stack[top - 2];
      let value: number;
      if (op === 0x10) value = (a + b) | 0;
      else if (op === 0x11) value = (a - b) | 0;
      else if (op === 0x12) value = Math.imul(a, b);
      else if (op === 0x13) {
        if (b === 0) return result(4);
        value = a === -2147483648 && b === -1 ? a : (a / b) | 0;
      } else if (op === 0x14) {
        if (b === 0) return result(4);
        value = b === -1 ? 0 : (a % b) | 0;
      } else if (op === 0x15) {
        if (b === 0) return result(4);
        value = Math.floor((a >>> 0) / (b >>> 0)) | 0;
      } else if (op === 0x16) {
        if (b === 0) return result(4);
        value = ((a >>> 0) % (b >>> 0)) | 0;
      } else if (op === 0x18) value = a & b;
      else if (op === 0x19) value = a | b;
      else if (op === 0x1a) value = a ^ b;
      else if (op === 0x1c) value = a << (b & 31);
      else if (op === 0x1d) value = a >> (b & 31);
      else if (op === 0x1e) value = (a >>> (b & 31)) | 0;
      else if (op === 0x20) value = a === b ? 1 : 0;
      else if (op === 0x21) value = a < b ? 1 : 0;
      else value = (a >>> 0) < (b >>> 0) ? 1 : 0;
      top -= 2;
      stack[top++] = value;
      continue;
    }
    if (op === 0x30 || op === 0x31 || op === 0x32) {
      const rel = ((prog[next - 2] | (prog[next - 1] << 8)) << 16) >> 16;
      let takeJump = true;
      if (op !== 0x30) {
        const v = stack[--top];
        takeJump = op === 0x31 ? v === 0 : v !== 0;
      }
      if (takeJump) pc = next + rel;
      continue;
    }
    if (op === 0x33) {
      if (depth === 64) return result(7);
      frames[depth++] = next;
      pc = prog[next - 2] | (prog[next - 1] << 8);
      continue;
    }
    if (op === 0x34) {
      if (depth === 0) return result(8);
      pc = frames[--depth];
      continue;
    }
    if (op === 0x40) {
      const addr = stack[top - 1];
      if (addr < 0 || addr >= 256) return result(6);
      stack[top - 1] = cells[addr];
      continue;
    }
    if (op === 0x41) {
      const addr = stack[top - 1];
      const v = stack[top - 2];
      if (addr < 0 || addr >= 256) return result(6);
      top -= 2;
      cells[addr] = v;
      continue;
    }
    if (op === 0x50) {
      const chunk = text.encode(String(stack[top - 1]));
      if (written + chunk.length > 65536) return result(11);
      top -= 1;
      bytes.set(chunk, written);
      written += chunk.length;
      continue;
    }
    if (op === 0x51) {
      if (written + 1 > 65536) return result(11);
      bytes[written++] = stack[--top] & 255;
      continue;
    }
    if (op === 0x52) {
      stack[top++] = read < input.length ? input[read++] : -1;
      continue;
    }
    if (op === 0x53) return result(stack[--top] & 255);
    return result(5);
  }
}

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of fs.readdirSync(inputDir).sort()) {
  const answer = execute(
    fs.readFileSync(path.join(inputDir, id, 'program.bin')),
    fs.readFileSync(path.join(inputDir, id, 'input.bin')),
  );
  fs.mkdirSync(path.join(outputDir, id), { recursive: true });
  fs.writeFileSync(path.join(outputDir, id, 'stdout.bin'), answer.bytes);
  fs.writeFileSync(path.join(outputDir, id, 'exit.txt'), `${answer.exit}\n`);
}
