using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Reflection.Emit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// Walks the call graph of a compiled method by reading its IL.
    ///
    /// Some guarantees are about what code cannot do, not about what it did on the run that
    /// happened to be observed. "A background reference read cannot open a document" is one of
    /// those: the failure it prevents needs a race to reproduce, so a test that calls the method
    /// and sees no window is evidence of very little. Reading the IL asks the question directly -
    /// is there any path from here to the method that opens documents - and answers it the same
    /// way every time.
    /// </summary>
    public static class MethodReachability
    {
        /// <summary>Every one-byte and two-byte opcode, indexed by value.</summary>
        private static readonly Dictionary<short, OpCode> Opcodes = typeof(OpCodes)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.FieldType == typeof(OpCode))
            .Select(field => (OpCode)field.GetValue(null)!)
            .GroupBy(opcode => opcode.Value)
            .ToDictionary(group => group.Key, group => group.First());

        /// <summary>
        /// Every method reachable from <paramref name="entryPoint"/>, following calls that stay
        /// inside its own assembly and recording the ones that leave it.
        ///
        /// Calls made through an interface are recorded by their declared name; the runtime target
        /// is not knowable here, and for the COM interfaces this is used on the declared name is
        /// exactly what matters.
        /// </summary>
        public static IReadOnlyCollection<MethodBase> Reachable(MethodBase entryPoint)
        {
            var seen = new HashSet<MethodBase>();
            var pending = new Stack<MethodBase>();
            pending.Push(entryPoint);

            while (pending.Count > 0)
            {
                var method = pending.Pop();
                if (!seen.Add(method)) continue;

                foreach (var called in CalledBy(method))
                {
                    if (seen.Contains(called)) continue;

                    // Only walk into code this assembly owns. Everything else is recorded as a leaf:
                    // the framework and the COM interop are not what these assertions are about.
                    if (called.Module == entryPoint.Module) pending.Push(called);
                    else seen.Add(called);
                }
            }

            seen.Remove(entryPoint);
            return seen;
        }

        /// <summary>Whether any method reachable from the entry point is named <paramref name="name"/>.</summary>
        public static bool Reaches(MethodBase entryPoint, string name) =>
            Reachable(entryPoint).Any(method => method.Name == name);

        /// <summary>The reachable method named <paramref name="name"/>, with the route to it, for a failure message.</summary>
        public static string Describe(MethodBase entryPoint, string name)
        {
            var hit = Reachable(entryPoint).FirstOrDefault(method => method.Name == name);
            return hit == null
                ? $"{name} is not reachable from {entryPoint.Name}"
                : $"{entryPoint.Name} can reach {hit.DeclaringType?.Name}.{hit.Name}";
        }

        private static IEnumerable<MethodBase> CalledBy(MethodBase method)
        {
            MethodBody? body;
            try
            {
                body = method.GetMethodBody();
            }
            catch (Exception)
            {
                yield break;
            }

            if (body == null) yield break;

            var il = body.GetILAsByteArray();
            if (il == null) yield break;

            var typeArguments = method.DeclaringType?.IsGenericType == true
                ? method.DeclaringType.GetGenericArguments()
                : null;
            var methodArguments = method.IsGenericMethodDefinition ? method.GetGenericArguments() : null;

            var offset = 0;
            while (offset < il.Length)
            {
                short value = il[offset];
                offset++;

                if (value == 0xFE && offset < il.Length)
                {
                    value = (short)(0xFE00 | il[offset]);
                    offset++;
                }

                if (!Opcodes.TryGetValue(value, out var opcode)) yield break;

                var operandSize = OperandSize(opcode, il, offset);
                if (operandSize < 0 || offset + operandSize > il.Length) yield break;

                if (IsCall(opcode))
                {
                    var token = BitConverter.ToInt32(il, offset);
                    MethodBase? called = null;
                    try
                    {
                        called = method.Module.ResolveMethod(token, typeArguments, methodArguments);
                    }
                    catch (Exception)
                    {
                        // A token this module cannot resolve names nothing this walk can follow.
                    }

                    if (called != null) yield return called;
                }

                offset += operandSize;
            }
        }

        private static bool IsCall(OpCode opcode) =>
            opcode == OpCodes.Call ||
            opcode == OpCodes.Callvirt ||
            opcode == OpCodes.Newobj ||
            opcode == OpCodes.Ldftn ||
            opcode == OpCodes.Ldvirtftn;

        private static int OperandSize(OpCode opcode, byte[] il, int offset)
        {
            switch (opcode.OperandType)
            {
                case OperandType.InlineNone:
                    return 0;
                case OperandType.ShortInlineBrTarget:
                case OperandType.ShortInlineI:
                case OperandType.ShortInlineVar:
                    return 1;
                case OperandType.InlineVar:
                    return 2;
                case OperandType.InlineBrTarget:
                case OperandType.InlineField:
                case OperandType.InlineI:
                case OperandType.InlineMethod:
                case OperandType.InlineSig:
                case OperandType.InlineString:
                case OperandType.InlineTok:
                case OperandType.InlineType:
                case OperandType.ShortInlineR:
                    return 4;
                case OperandType.InlineI8:
                case OperandType.InlineR:
                    return 8;
                case OperandType.InlineSwitch:
                    if (offset + 4 > il.Length) return -1;
                    return 4 + (BitConverter.ToInt32(il, offset) * 4);
                default:
                    return -1;
            }
        }
    }
}
