import fs from "fs";
import path from "path";
import parser from "@solidity-parser/parser";

const ROOT = path.resolve("fetcher/contracts");
const MAX_RECURSION_DEPTH = 50;

/* -------------------- UTILS -------------------- */


// Recursively find all .sol files
function findSolFiles(dir) {
  let solFiles = [];
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        solFiles = solFiles.concat(findSolFiles(fullPath));
      } else if (file.name.endsWith(".sol")) {
        solFiles.push(fullPath);
      }
    }
  } catch (e) {
    console.error(`❌ Error reading directory ${dir}: ${e.message}`);
  }
  return solFiles;
}

// Skip junk files: only library, interface, or abstract contract
function hasConcreteContractAST(ast) {
  let ok = false;
  try {
    parser.visit(ast, {
      ContractDefinition(node) {
        if (node.kind === "contract") ok = true;
      },
    });
  } catch (e) {
    console.error(`❌ Error visiting AST: ${e.message}`);
  }
  return ok;
}

function extractLValue(expr) {
  if (!expr) return null;
  if (expr.type === "Identifier") return expr.name;
  if (expr.type === "MemberAccess" || expr.type === "IndexAccess") return stringifyExpr(expr);
  return null;
}

/* -------------------- TYPE HELPERS -------------------- */

function getParamType(p) {
  if (!p || !p.typeName) return "unknown";
  const t = p.typeName;
  switch (t.type) {
    case "ElementaryTypeName":
      return t.name;
    case "ArrayTypeName":
      return `${getParamType({ typeName: t.baseTypeName })}[]`;
    case "Mapping":
      return `mapping(${getParamType({ typeName: t.keyType })} => ${getParamType({ typeName: t.valueType })})`;
    case "UserDefinedTypeName":
      return t.name;
    case "FunctionTypeName":
      return "function";
    case "BytesTypeName":
      return t.kind === "dynamic" ? "bytes" : `bytes${t.kind}`;
    default:
      return "unknown";
  }
}

function getFunctionName(fn) {
  if (fn.isConstructor) return "constructor";
  if (fn.isReceiveEther) return "receive";
  if (fn.isFallback) return "fallback";
  return fn.name || "unknown";
}

function classifyCall(expr, ctx) {
  if (!expr || expr.type !== "FunctionCall") return null;

  const callee = expr.expression;

  // foo()
  if (callee.type === "Identifier") {
    if (ctx.functions[callee.name]) {
      return { kind: "internal", function: callee.name };
    }
  }

  // this.foo(), super.foo(), Lib.foo(), addr.foo()
  if (callee.type === "MemberAccess") {
    const target = stringifyExpr(callee.expression);
    const fn = callee.memberName;

    // LOW-LEVEL CALLS
    if (["call", "delegatecall", "staticcall"].includes(fn)) {
      return {
        kind: "lowlevel",
        target,
        function: fn
      };
    }

    if (target === "this") {
      return { kind: "self-external", function: fn };
    }

    if (target === "super") {
      return { kind: "internal-super", function: fn };
    }

  if (ctx.usingFor && ctx.usingFor[callee.expression?.typeName?.name]) {
    return {
    kind: "library",
    library: ctx.usingFor[callee.expression.typeName.name],
    function: fn
    };
    }

    return { kind: "external", target, function: fn };
  }

  return null;
}

function applyModifier(mod, innerBody) {
  if (!mod?.body?.statements) return innerBody;

  const wrappedStatements = mod.body.statements.map(stmt => {
    if (stmt.type === "PlaceholderStatement") return innerBody;
    return stmt;
  });

  return { type: "Block", statements: wrappedStatements };
}



function isStateVarAccess(expr, stateVars) {
  if (!expr) return null;

  if (expr.type === "Identifier" && stateVars.has(expr.name)) {
    return expr.name;
  }

  if (
    expr.type === "MemberAccess" ||
    expr.type === "IndexAccess"
  ) {
    return stringifyExpr(expr);
  }

  return null;
}


function stringifyExpr(node) {
  if (!node) return "";
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "Literal":
      return node.value?.toString() || "";
    case "MemberAccess":
      return `${stringifyExpr(node.expression)}.${node.memberName}`;
    case "BinaryOperation":
      return `(${stringifyExpr(node.left)} ${node.operator} ${stringifyExpr(node.right)})`;
    case "FunctionCall":
      return `${stringifyExpr(node.expression)}(${(node.arguments || []).map(stringifyExpr).join(", ")})`;
    case "IndexAccess":
      return `${stringifyExpr(node.base)}[${stringifyExpr(node.index)}]`;
    case "UnaryOperation":
      return `${node.operator}${stringifyExpr(node.subExpression)}`;
    default:
      return node.type;
  }
}

function emptySlice(contract, fn, filePath) {
  return {
     contract,
    file: path.basename(filePath), // ✅ REQUIRED
    function: getFunctionName(fn),
    visibility: fn.visibility || "internal",
    mutability: fn.stateMutability || "nonpayable",
    parameters: fn.parameters?.map(getParamType) || [],
    modifiers: fn.modifiers?.map(m => m.name) || [],
    preconditions: [],
    internalCalls: [],
    externalCalls: [],
     callGraph: [],  
    stateReads: [],
    stateWrites: [],
    environmentReads: [],
    valueTransfers: [],
    eventsEmitted: [],
    entrypoint: ["public", "external"].includes(fn.visibility),
    signature: `${getFunctionName(fn)}(${(fn.parameters || [])
  .map(getParamType)
  .join(",")})`,

  };
}

/* -------------------- INHERITANCE MERGE -------------------- */

function mergeInherited(contractName, contracts, functions, stateVars, modifiers, visited = new Set()) {
  if (visited.has(contractName)) return { functions: {}, stateVars: new Set(), modifiers: {} };
  visited.add(contractName);

  const node = contracts[contractName];
  if (!node) return { functions: {}, stateVars: new Set(), modifiers: {} };

  let mergedFunctions = { ...functions[contractName] };
  let mergedStateVars = new Set([...stateVars[contractName]]);
  let mergedModifiers = { ...modifiers[contractName] };

  for (const base of node.baseContracts || []) {
    const baseName = base.baseName?.namePath;
    if (!baseName) continue;
    const parent = mergeInherited(baseName, contracts, functions, stateVars, modifiers, visited);
    mergedFunctions = { ...parent.functions, ...mergedFunctions };
    mergedStateVars = new Set([...parent.stateVars, ...mergedStateVars]);
    mergedModifiers = { ...parent.modifiers, ...mergedModifiers };
  }

  return { functions: mergedFunctions, stateVars: mergedStateVars, modifiers: mergedModifiers };
}

/* -------------------- STATEMENT & EXPRESSION ANALYSIS -------------------- */

function analyzeStatement(stmt, ctx, depth = 0) {
  if (!stmt || depth > MAX_RECURSION_DEPTH) return;

  try {
    switch (stmt.type) {
      case "Block":
        stmt.statements?.forEach(s =>
          analyzeStatement(s, ctx, depth + 1)
        );
        break;

      case "ExpressionStatement":
        analyzeExpression(stmt.expression, ctx, depth + 1);
        break;

      case "ReturnStatement":
        analyzeExpression(stmt.expression, ctx, depth + 1);
        break;

      case "InlineAssemblyStatement":
  ctx.slice.environmentReads.push("inline-assembly");
  break;


      case "IfStatement":
        analyzeExpression(stmt.condition, ctx, depth + 1);
        analyzeStatement(stmt.trueBody, ctx, depth + 1);
        analyzeStatement(stmt.falseBody, ctx, depth + 1);
        break;

      case "ForStatement":
        analyzeStatement(stmt.initializationExpression, ctx, depth + 1);
        analyzeExpression(stmt.conditionExpression, ctx, depth + 1);
        analyzeExpression(stmt.loopExpression, ctx, depth + 1);
        analyzeStatement(stmt.body, ctx, depth + 1);
        break;

      case "WhileStatement":
      case "DoWhileStatement":
        analyzeExpression(stmt.condition, ctx, depth + 1);
        analyzeStatement(stmt.body, ctx, depth + 1);
        break;

      case "TryStatement":
        analyzeExpression(stmt.externalCall, ctx, depth + 1);
        stmt.clauses?.forEach(c =>
          analyzeStatement(c.body, ctx, depth + 1)
        );
        break;

      case "UncheckedBlock":
        analyzeStatement(stmt.block, ctx, depth + 1);
        break;

      case "EmitStatement":
        ctx.slice.eventsEmitted.push(
          stringifyExpr(stmt.eventCall)
        );
        break;

      case "RevertStatement":
        stmt.arguments?.forEach(a =>
          analyzeExpression(a, ctx, depth + 1)
        );
        break;
    }
  } catch (e) {
    console.error(`❌ Statement error: ${e.message}`);
  }
}


function analyzeExpression(expr, ctx, depth) {
  if (!expr || depth > MAX_RECURSION_DEPTH) return;

  try {
    if (expr.type === "FunctionCall" && ["require", "assert"].includes(expr.expression?.name)) {
      ctx.slice.preconditions.push(stringifyExpr(expr.arguments[0]));
      return;
    }

    if (expr.type === "UnaryOperation" && expr.operator === "!" && expr.subExpression) {
      ctx.slice.preconditions.push(`!${stringifyExpr(expr.subExpression)}`);
      return;
    }

  if (
  expr.type === "BinaryOperation" &&
  ["=", "+=", "-=", "*=", "/=", "%="].includes(expr.operator)
) {
  const lval = isStateVarAccess(expr.left, ctx.stateVars);
  if (lval) ctx.slice.stateWrites.push({ var: lval });
  analyzeExpression(expr.right, ctx, depth + 1);
  return;
}

if (
  expr.type === "UnaryOperation" &&
  ["++", "--", "delete"].includes(expr.operator)
) {
  const lval = isStateVarAccess(expr.subExpression, ctx.stateVars);
  if (lval) ctx.slice.stateWrites.push({ var: lval });
  return;
}

    if (expr.type === "FunctionCall" && stringifyExpr(expr.expression) === "gasleft") {
      ctx.slice.environmentReads.push("gasleft()");
    }

    if (expr.type === "Identifier" && ctx.stateVars.has(expr.name)) {
      ctx.slice.stateReads.push({ var: expr.name });
      
    }

    if (expr.type === "MemberAccess") {
      const full = `${stringifyExpr(expr.expression)}.${expr.memberName}`;
      if ([
        "msg.sender", "msg.value", "msg.data", "msg.sig",
        "block.timestamp", "block.number", "block.chainid",
        "block.prevrandao", "tx.origin"
      ].includes(full)) {
        ctx.slice.environmentReads.push(full);
      }
    }

    if (expr.type === "FunctionCall") processFunctionCall(expr, ctx, depth);

    for (const key in expr) {
      const child = expr[key];
      if (Array.isArray(child)) child.forEach(c => analyzeExpression(c, ctx, depth + 1));
      else if (child?.type) analyzeExpression(child, ctx, depth + 1);
    }
  } catch (e) {
    console.error(`❌ Error analyzing expression at depth ${depth}: ${e.message}`);
  }
}

function processFunctionCall(expr, ctx, depth) {
  try {
    const current = ctx.callStack[ctx.callStack.length - 1];
    const info = classifyCall(expr, ctx);

    if (!info) return;

    /* ---------- INTERNAL ---------- */
    if (info.kind === "internal" || info.kind === "internal-super") {
      ctx.slice.internalCalls.push({
        contract: ctx.contract,
        function: info.function
      });

      ctx.slice.callGraph.push({
        from: current,
        to: `${ctx.contract}.${info.function}`,
        kind: "internal"
      });

      if (depth < MAX_RECURSION_DEPTH) {
        const fns = ctx.functions[info.function] || [];
        for (const fn of fns) {
          ctx.callStack.push(`${ctx.contract}.${info.function}`);
          analyzeStatement(fn.body, ctx, depth + 1);
          ctx.callStack.pop();
        }
      }
      return;
    }

    /* ---------- SELF-EXTERNAL ---------- */
    if (info.kind === "self-external") {
      ctx.slice.externalCalls.push({
        target: ctx.contract,
        function: info.function,
        selfExternal: true
      });

      ctx.slice.callGraph.push({
        from: current,
        to: `${ctx.contract}.${info.function}`,
        kind: "self-external"
      });
      return;
    }

    /* ---------- LIBRARY ---------- */
    if (info.kind === "library") {
      ctx.slice.internalCalls.push({
        contract: info.library,
        function: info.function,
        via: "library"
      });

      ctx.slice.callGraph.push({
        from: current,
        to: `${info.library}.${info.function}`,
        kind: "library"
      });
      return;
    }

    /* ---------- LOW-LEVEL ---------- */
    if (info.kind === "lowlevel") {
      ctx.slice.externalCalls.push({
        target: info.target,
        function: info.function,
        lowLevel: true
      });

      ctx.slice.callGraph.push({
        from: current,
        to: `${info.target}.${info.function}`,
        kind: info.function
      });

      ctx.slice.valueTransfers.push({
        to: info.target,
        amount: expr.options?.value
          ? stringifyExpr(expr.options.value)
          : "unknown"
      });
      return;
    }

    /* ---------- EXTERNAL ---------- */
    if (info.kind === "external") {
      ctx.slice.externalCalls.push({
        target: info.target,
        function: info.function,
        valueDependent: !!expr.options?.value,
        userControlledTarget: info.target.includes("msg.sender")
      });

      ctx.slice.callGraph.push({
        from: current,
        to: `${info.target}.${info.function}`,
        kind: "external"
      });

      if (expr.options?.value) {
        ctx.slice.valueTransfers.push({
          to: info.target,
          amount: stringifyExpr(expr.options.value)
        });
      }
    }
  } catch (e) {
    console.error(`❌ Error processing function call: ${e.message}`);
  }
}

/* -------------------- MAIN -------------------- */

export function analyzeContract(project) {
  console.log(`Analyzing project: ${project}`);
  try {
    const projectDir = path.join(ROOT, project, "project");
    const statePath = path.join(projectDir, "state.json");
    const usingFor = {};


    if (!fs.existsSync(statePath)) {
      console.warn(`⚠️ No state.json for ${project}, skipping analysis`);
      return;
    }

    const { status } = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (status !== "buildable") {
      console.warn(`⚠️ Project ${project} not buildable, skipping analysis`);
      return;
    }

    const srcDir = path.join(projectDir, "contracts");
    if (!fs.existsSync(srcDir)) return;

    const outDir = path.join(ROOT, project, "analysis");
    fs.mkdirSync(outDir, { recursive: true });
    const allSlices = [];

    const solFiles = findSolFiles(srcDir);
    console.log(`🔍 Found ${solFiles.length} Solidity files in ${srcDir}`);

    for (const filePath of solFiles) {
      let ast;
      try {
        const source = fs.readFileSync(filePath, "utf8");
        ast = parser.parse(source, { tolerant: true, range: true });
        console.log(`✅ Parsed ${filePath}`);
      } catch (e) {
        console.error(`❌ Failed to parse ${filePath}: ${e.message}`);
        continue;
      }

      if (!hasConcreteContractAST(ast)) {
        console.log(`ℹ️ Skipping ${filePath}: no concrete contracts`);
        continue;
      }

      const contracts = {}, functions = {}, stateVars = {}, modifiers = {};

      try {
        parser.visit(ast, {
          ContractDefinition(node) {
            contracts[node.name] = node;
            functions[node.name] = {};
            stateVars[node.name] = new Set();
            modifiers[node.name] = {};
            usingFor[node.name] = {};


            for (const sub of node.subNodes || []) {
              if (sub.type === "StateVariableDeclaration")
                sub.variables.forEach(v => stateVars[node.name].add(v.name));
              if (sub.type === "UsingForDeclaration") {
                usingFor[node.name][sub.libraryName] = sub.typeName?.name || "*";
                }


              if (sub.type === "FunctionDefinition") {

                if (!sub.name && !sub.isConstructor && !sub.isFallback && !sub.isReceiveEther) {
                console.warn(`⚠️ FunctionDefinition missing name in contract ${node.name}`);
                }
          let name = getFunctionName(sub);
          if (!name) name = "unknown";

  // Ensure it's an array
  if (!Array.isArray(functions[node.name][name])) {
    functions[node.name][name] = [];
  }

  functions[node.name][name].push(sub);
}

              if (sub.type === "ModifierDefinition")
                modifiers[node.name][sub.name] = sub;
            }
          },
        });
      } catch (e) {
        console.error(`❌ Failed to visit AST for ${filePath}: ${e.message}`);
        continue;
      }

      for (const contractName of Object.keys(contracts)) {
        const merged = mergeInherited(contractName, contracts, functions, stateVars, modifiers);

        for (const fnList of Object.values(merged.functions)) {
          for (const fn of Array.isArray(fnList) ? fnList : [fnList]) {
            const slice = emptySlice(contractName, fn, filePath);
            const ctx = {
              contract: contractName,
              functions: merged.functions,
              stateVars: merged.stateVars,
              usingFor: usingFor[contractName],
              slice,
              callStack: [`${contractName}.${getFunctionName(fn)}`],
            };

            try {
                // Start with the original function body
  let wrappedBody = fn.body;

  // Wrap modifiers from last to first (so the first modifier is applied outermost)
  if (fn.modifiers?.length) {
                for (let i = fn.modifiers.length - 1; i >= 0; i--) {
                  const mod = merged.modifiers[fn.modifiers[i].name];
                  if (mod?.body) {
                    wrappedBody = applyModifier(mod, wrappedBody);
                  }
                }
                  }

                  // Analyze the fully wrapped body
             analyzeStatement(wrappedBody, ctx, 0);


              allSlices.push(slice);
            } catch (e) {
              console.error(`❌ Failed to analyze function ${getFunctionName(fn)} in ${filePath}: ${e.message}`);
            }
          }
        }
      }
    }

    const outPath = path.join(outDir, "analysis.json");
    fs.writeFileSync(outPath, JSON.stringify(allSlices, null, 2));
    console.log(`✅ Analysis written to ${outPath}`);
  } catch (e) {
    console.error(`❌ Fatal error in analyzeContract: ${e.message}`);
  }
}

  const project = process.argv[2];
  if (!project) {
    console.error("Usage: node analyzer.js <projectName>");
    process.exit(1);
  } else {
    analyzeContract(project);
  }




// import fs from "fs";
// import path from "path";
// import * as parser from "solidity-parser-antlr";

// const ROOT = path.resolve("fetcher/contracts");
// const MAX_RECURSION_DEPTH = 50;

// /* -------------------- UTILS -------------------- */

// // Recursively find all .sol files
// function findSolFiles(dir) {
//   let solFiles = [];
//   const files = fs.readdirSync(dir, { withFileTypes: true });

//   for (const file of files) {
//     const fullPath = path.join(dir, file.name);

//     if (file.isDirectory()) {
//       solFiles = solFiles.concat(findSolFiles(fullPath));
//     } else if (file.name.endsWith(".sol")) {
//       solFiles.push(fullPath);
//     }
//   }

//   return solFiles;
// }

// // Skip junk files: only library, interface, or abstract contract
// function hasConcreteContractAST(ast) {
//   let ok = false;
//   parser.visit(ast, {
//     ContractDefinition(node) {
//       if (node.kind === "contract") ok = true;
//     }
//   });
//   return ok;
// }
// function extractLValue(expr) {
//   if (!expr) return null;
//   if (expr.type === "Identifier") return expr.name;
//   if (expr.type === "MemberAccess") return stringifyExpr(expr);
//   if (expr.type === "IndexAccess") return stringifyExpr(expr);
//   return null;
// }


// /* -------------------- TYPE HELPERS -------------------- */

// function getParamType(p) {
//   if (!p || !p.typeName) return "unknown";
//   const t = p.typeName;

//   switch (t.type) {
//     case "ElementaryTypeName": return t.name;
//     case "ArrayTypeName": return `${getParamType({ typeName: t.baseTypeName })}[]`;
//     case "Mapping": return `mapping(${getParamType({ typeName: t.keyType })} => ${getParamType({ typeName: t.valueType })})`;
//     case "UserDefinedTypeName": return t.name;
//     case "FunctionTypeName": return "function";
//     case "BytesTypeName": return t.kind === "dynamic" ? "bytes" : `bytes${t.kind}`;
//     default: return "unknown";
//   }
// }

// function getFunctionName(fn) {
//   if (fn.isConstructor) return "constructor";
//   if (fn.isReceiveEther) return "receive";
//   if (fn.isFallback) return "fallback";
//   return fn.name || "unknown";
// }

// function stringifyExpr(node) {
//   if (!node) return "";
//   switch (node.type) {
//     case "Identifier": return node.name;
//     case "Literal": return node.value?.toString() || "";
//     case "MemberAccess": return `${stringifyExpr(node.expression)}.${node.memberName}`;
//     case "BinaryOperation": return `(${stringifyExpr(node.left)} ${node.operator} ${stringifyExpr(node.right)})`;
//     case "FunctionCall": return `${stringifyExpr(node.expression)}(${(node.arguments || []).map(stringifyExpr).join(", ")})`;
//     case "IndexAccess": return `${stringifyExpr(node.base)}[${stringifyExpr(node.index)}]`;
//     case "UnaryOperation": return `${node.operator}${stringifyExpr(node.subExpression)}`;
//     default: return node.type;
//   }
// }

// function emptySlice(contract, fn) {
//   return {
//     contract,
//     function: getFunctionName(fn),
//     visibility: fn.visibility || "internal",
//     mutability: fn.stateMutability || "nonpayable",
//     parameters: fn.parameters?.map(p => getParamType(p)) || [],
//     modifiers: fn.modifiers?.map(m => m.name) || [],
//     preconditions: [],
//     callGraph: [],
//     externalCalls: [],
//     stateReads: [],
//     stateWrites: [],
//     environmentReads: [],
//     valueTransfers: [],
//     eventsEmitted: [],
//     entrypoint: ["public", "external"].includes(fn.visibility)
//   };
// }

// /* -------------------- INHERITANCE MERGE -------------------- */

// function mergeInherited(contractName, contracts, functions, stateVars, modifiers, visited = new Set()) {
//   if (visited.has(contractName)) return { functions: {}, stateVars: new Set(), modifiers: {} };
//   visited.add(contractName);

//   const node = contracts[contractName];
//   if (!node) return { functions: {}, stateVars: new Set(), modifiers: {} };

//   let mergedFunctions = { ...functions[contractName] };
//   let mergedStateVars = new Set([...stateVars[contractName]]);
//   let mergedModifiers = { ...modifiers[contractName] };

//   for (const base of node.baseContracts || []) {
//     const baseName = base.baseName?.namePath;
//     if (!baseName) continue;
//     const parent = mergeInherited(baseName, contracts, functions, stateVars, modifiers, visited);
//     mergedFunctions = { ...parent.functions, ...mergedFunctions };
//     mergedStateVars = new Set([...parent.stateVars, ...mergedStateVars]);
//     mergedModifiers = { ...parent.modifiers, ...mergedModifiers };
//   }

//   return { functions: mergedFunctions, stateVars: mergedStateVars, modifiers: mergedModifiers };
// }

// /* -------------------- STATEMENT & EXPRESSION ANALYSIS -------------------- */

// function analyzeStatement(stmt, ctx, depth = 0) {
//   if (!stmt || depth > MAX_RECURSION_DEPTH) return;

//   switch (stmt.type) {
//     case "ExpressionStatement": analyzeExpression(stmt.expression, ctx, depth); break;
//     case "ReturnStatement": analyzeExpression(stmt.expression, ctx, depth); break;
//     case "IfStatement":
//       analyzeExpression(stmt.condition, ctx, depth);
//       analyzeStatement(stmt.trueBody, ctx, depth + 1);
//       analyzeStatement(stmt.falseBody, ctx, depth + 1);
//       break;
//     case "Block": stmt.statements.forEach(s => analyzeStatement(s, ctx, depth + 1)); break;
//     case "EmitStatement": ctx.slice.eventsEmitted.push(stringifyExpr(stmt.eventCall)); break;
//   }
// }

// function analyzeExpression(expr, ctx, depth) {
//   if (!expr) return;

//   if (expr.type === "FunctionCall" && ["require", "assert"].includes(expr.expression?.name)) {
//     ctx.slice.preconditions.push(stringifyExpr(expr.arguments[0]));
//     return;
//   }

//   if (expr.type === "UnaryOperation" && expr.operator === "!" && expr.subExpression) {
//     ctx.slice.preconditions.push(`!${stringifyExpr(expr.subExpression)}`);
//     return;
//   }

// if (expr.type === "BinaryOperation" && expr.operator === "=") {
//   const lval = extractLValue(expr.left);
//   if (lval) ctx.slice.stateWrites.push({ var: lval });
//   analyzeExpression(expr.right, ctx, depth + 1);
//   return;
// }

//   if (expr.type === "FunctionCall" && stringifyExpr(expr.expression) === "gasleft") {
//   ctx.slice.environmentReads.push("gasleft()");
// }



//   if (expr.type === "Identifier" && ctx.stateVars.has(expr.name)) {
//     ctx.slice.stateReads.push({ var: expr.name });
//     return;
//   }

//   if (expr.type === "MemberAccess") {
//     const full = `${stringifyExpr(expr.expression)}.${expr.memberName}`;
//    if ([
//   "msg.sender",
//   "msg.value",
//   "msg.data",
//   "msg.sig",
//   "block.timestamp",
//   "block.number",
//   "block.chainid",
//   "block.prevrandao",
//   "tx.origin"
// ].includes(full)) {
//  ctx.slice.environmentReads.push(full);
//     }
//   }

//   if (expr.type === "FunctionCall") processFunctionCall(expr, ctx, depth);

//   for (const key in expr) {
//     const child = expr[key];
//     if (Array.isArray(child)) child.forEach(c => analyzeExpression(c, ctx, depth + 1));
//     else if (child?.type) analyzeExpression(child, ctx, depth + 1);
//   }
// }

// function processFunctionCall(expr, ctx, depth) {
//   const current = ctx.callStack[ctx.callStack.length - 1];
//   const exp = expr.expression;

//   // INTERNAL CALL
//   if (exp.type === "Identifier" && ctx.functions[exp.name]) {
//     ctx.slice.callGraph.push({ from: current, to: `${ctx.contract}.${exp.name}`, kind: "internal" });
//     return;
//   }

//   // EXTERNAL CALL
//   if (exp.type === "MemberAccess") {
//     const target = stringifyExpr(exp.expression);
//     const fn = exp.memberName;

//     ctx.slice.callGraph.push({ from: current, to: `${target}.${fn}`, kind: "external" });

//     ctx.slice.externalCalls.push({
//       target,
//       function: fn,
//       valueDependent: !!expr.options?.value,
//       userControlledTarget: target.includes("msg.sender")
//     });

//     if (expr.options?.value) {
//       ctx.slice.valueTransfers.push({ to: target, amount: stringifyExpr(expr.options.value) });
//     }
//   }
// }

// /* -------------------- MAIN -------------------- */

// export function analyzeContract(project) {
//   const projectDir = path.join(ROOT, project, "project");
//   const statePath = path.join(projectDir, "state.json");

//   if (!fs.existsSync(statePath)) {
//     console.warn(`⚠️ No state.json for ${project}, skipping analysis`);
//     return;
//   }

//   const { status } = JSON.parse(fs.readFileSync(statePath, "utf8"));
//   if (status !== "buildable") {
//     console.warn(`⚠️ Project ${project} not buildable, skipping analysis`);
//     return;
//   }

//   const srcDir = path.join(projectDir, "contracts");
//   if (!fs.existsSync(srcDir)) return;


//   const outDir = path.join(ROOT, project, "analysis");
//   fs.mkdirSync(outDir, { recursive: true });
//     const allSlices = [];

//     // Recursively get all .sol files
//     const solFiles = findSolFiles(srcDir);

//    for (const filePath of solFiles) {
//   let ast;
//   try {
//     const source = fs.readFileSync(filePath, "utf8");
//    ast = parser.parse(source, {
//   tolerant: true,
//   range: true
// });

//   } catch (e) {
//     console.error(`❌ Failed to parse ${filePath}: ${e.message}`);
//     continue;
//   }

//   if (!hasConcreteContractAST(ast)) continue;

//   const contracts = {}, functions = {}, stateVars = {}, modifiers = {};

//       try {
//         parser.visit(ast, {
//           ContractDefinition(node) {
//             contracts[node.name] = node;
//             functions[node.name] = {};
//             stateVars[node.name] = new Set();
//             modifiers[node.name] = {};

//             for (const sub of node.subNodes || []) {
//               if (sub.type === "StateVariableDeclaration")
//                 sub.variables.forEach(v => stateVars[node.name].add(v.name));
//               if (sub.type === "FunctionDefinition") {
//                const name = getFunctionName(sub);
//               functions[node.name][name] ??= [];
//                functions[node.name][name].push(sub);
//               }
//               if (sub.type === "ModifierDefinition")
//                 modifiers[node.name][sub.name] = sub;
//             }
//           }
//         });
//       } catch (e) {
//         console.error(`❌ Failed to visit AST for ${filePath}: ${e.message}`);
//         continue;
//       }

//       for (const contractName of Object.keys(contracts)) {
//         const merged = mergeInherited(contractName, contracts, functions, stateVars, modifiers);

// for (const fnList of Object.values(merged.functions)) {
//   for (const fn of Array.isArray(fnList) ? fnList : [fnList]) {
//   const slice = emptySlice(contractName, fn);
//           const ctx = {
//             contract: contractName,
//             functions: merged.functions,
//             stateVars: merged.stateVars,
//             slice,
//             callStack: [`${contractName}.${getFunctionName(fn)}`]
//           };

//           try {
//             fn.modifiers?.forEach(m => {
//               const mod = merged.modifiers[m.name];
//               if (mod?.body) analyzeStatement(mod.body, ctx, 0);
//             });
//             analyzeStatement(fn.body, ctx, 0);
//             allSlices.push(slice);
//           } catch (e) {
//             console.error(`❌ Failed to analyze function ${getFunctionName(fn)} in ${filePath}: ${e.message}`);
//           }
//         }
//       }
//     }

//     fs.writeFileSync(path.join(outDir, "analysis.json"), JSON.stringify(allSlices, null, 2));
//     console.log(`✅ Analysis written to ${path.join(outDir, "analysis.json")}`);
// }
// }



// if (import.meta.url === `file://${process.argv[1]}`) {
//   const project = process.argv[2];
//   if (!project) {
//     console.error("Usage: node analyzer.js <projectName>");
//     process.exit(1);
//   }}