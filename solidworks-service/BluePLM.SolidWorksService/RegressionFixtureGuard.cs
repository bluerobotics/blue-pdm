using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

using Microsoft.Win32.SafeHandles;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// Decides whether a path may be written to by a diagnostic or a regression test.
    ///
    /// Anything that writes to a real SolidWorks document is one typo away from modifying a
    /// production vault file, so this is an authorisation decision rather than a string comparison,
    /// and it is answered the same way round every time: a path is refused unless it can be proven
    /// to be inside the root. Anything that cannot be proven either way is refused.
    ///
    /// What "proven" means here:
    ///
    /// - The path is absolute and names a volume, so the verdict cannot change with the process
    ///   working directory. Relative paths are refused, not resolved. Resolving an operator's
    ///   argument is the caller's job; see the <c>--dm-probe</c> handling in Program.cs.
    /// - The path is already canonical. No <c>..</c>, no <c>.</c>, no 8.3 short name, no name ending
    ///   in a dot or a space. The guard does not collapse or expand anything, so it cannot be fooled
    ///   by a shape whose collapsing rules it got wrong.
    /// - The path does not use the <c>\\?\</c> or <c>\\.\</c> prefix. Those switch off Win32 path
    ///   normalisation entirely - Windows leaves <c>..</c> in such a path unresolved - which voids
    ///   every assumption below.
    /// - Containment is decided component by component, not by string prefix, so a sibling named
    ///   <c>00 - REGRESSION TESTS ARCHIVE</c> cannot pass as the root.
    /// - No junction or symbolic link stands anywhere between the volume root and the path, the
    ///   allowed root itself included. A reparse point makes the name a lie, and one planted at or
    ///   above the root redirects the whole fixture folder.
    /// - The path has one name. A hard link carries no attribute that says so, so every check above
    ///   can pass on a name inside the root while the bytes behind it are a production document with
    ///   a second directory entry elsewhere on the volume. The link count is asked for directly.
    /// - The root is deep enough to confine anything. A well-formed root can still be useless as a
    ///   boundary: <c>C:\</c> has no components below its volume, so containment compares nothing
    ///   and every path on the drive passes. Being a valid path and being a usable root are
    ///   separate questions, and both are asked.
    /// - The root is not the vault. Depth cannot decide this one -
    ///   <c>C:\BluePLM\br-vault\Engineering</c> is exactly as deep as a legitimate throwaway
    ///   sandbox - so <see cref="ProductionVaultRoot"/> is named and any root inside it other than
    ///   <see cref="DefaultFixtureRoot"/> is refused outright.
    ///
    /// What it does not prove: that the answer is still true a moment later. Nothing that inspects a
    /// path and then acts on it can promise that, so the callers back a write with
    /// <see cref="FixtureBackup"/> rather than relying on this alone.
    /// </summary>
    public static class RegressionFixtureGuard
    {
        /// <summary>Only folder in the vault a write is ever permitted to reach.</summary>
        public const string DefaultFixtureRoot = @"C:\BluePLM\br-vault\0 - SHARED\00 - REGRESSION TESTS";

        /// <summary>
        /// The production vault, named so the guard can refuse to be pointed anywhere inside it
        /// except <see cref="DefaultFixtureRoot"/>.
        ///
        /// A depth floor cannot express this. <c>C:\BluePLM\br-vault\Engineering</c> is as many
        /// folders below its volume as a legitimate throwaway sandbox and contains nothing but
        /// production documents, so the question has to be asked directly rather than
        /// approximated by counting.
        /// </summary>
        public const string ProductionVaultRoot = @"C:\BluePLM\br-vault";

        /// <summary>
        /// Overrides <see cref="DefaultFixtureRoot"/>, so a test can point a spawned diagnostic at a
        /// throwaway copy of a fixture instead of the vault. It must itself be an absolute, canonical
        /// path, and deep enough to be a boundary; a root that does not satisfy the rules above
        /// refuses everything, whether it is malformed or merely too broad.
        /// </summary>
        public const string FixtureRootVariable = "BLUEPLM_FIXTURE_ROOT";

        /// <summary>A fixture path is a handful of levels below its root, never more than this.</summary>
        private const int MaxDepthBelowRoot = 12;

        /// <summary>
        /// Named folders a root must have below its volume before it can confine anything.
        ///
        /// A root of <c>C:\</c> parses perfectly well - it is absolute, canonical and names a
        /// volume - and has zero components, so the component-by-component containment check below
        /// compares nothing and authorises the entire drive. The same is true of <c>\\server\share</c>,
        /// and one component short of it lets through <c>C:\Windows</c> and <c>C:\Users</c>. Those
        /// are precisely the roots a typo or an unset environment variable produces, so the shape of
        /// the root is checked rather than assumed. The real fixture root has four.
        ///
        /// Three rather than two because <c>C:\BluePLM\br-vault</c> has two, and a root of two
        /// components authorises a write to every document in the vault while satisfying every
        /// other rule here. Three is also the shallowest root the guard is asked to accept in
        /// practice: a temporary directory is six or so components deep locally and three on a CI
        /// runner (<c>D:\a\_temp\sandbox</c>).
        ///
        /// This is a floor and not the boundary. It cannot be raised into one, because the vault
        /// has folders below it that are as deep as any legitimate sandbox; see
        /// <see cref="DescribeVaultOverlap"/> for the check that actually keeps a root out of the
        /// vault.
        /// </summary>
        private const int MinRootComponents = 3;

        /// <summary>
        /// Total components a path may have, root included. Splitting on separators cannot loop, so
        /// this is only here to stop a crafted path turning the ancestor walk into thousands of
        /// file system calls.
        /// </summary>
        private const int MaxPathComponents = 64;

        private static readonly char[] Separators = { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar };

        private static readonly string SeparatorText = Path.DirectorySeparatorChar.ToString();

        /// <summary>Characters that cannot appear in a component of a path this guard will allow.</summary>
        private static readonly char[] ForbiddenInComponent = { ':', '*', '?', '"', '<', '>', '|' };

        /// <summary>What the volume root and the components below it turned out to be.</summary>
        private enum Probe
        {
            /// <summary>Attributes were read.</summary>
            Readable,

            /// <summary>Nothing is there, so nothing below it can be there either.</summary>
            Absent,

            /// <summary>Something is there but the guard cannot see what. Never treated as safe.</summary>
            Unreadable,
        }

        /// <summary>The root writes are currently confined to.</summary>
        public static string ResolveAllowedRoot()
        {
            var configured = Environment.GetEnvironmentVariable(FixtureRootVariable);
            return string.IsNullOrWhiteSpace(configured) ? DefaultFixtureRoot : configured!;
        }

        /// <summary>Whether <paramref name="candidate"/> is inside <see cref="ResolveAllowedRoot"/>.</summary>
        public static bool IsInsideAllowedRoot(string? candidate) => IsInside(candidate, ResolveAllowedRoot());

        /// <summary>
        /// Why <paramref name="root"/> cannot confine anything, or null when it can.
        ///
        /// Callers that sweep or enumerate a root ask this first: a root that authorises nothing
        /// would otherwise send them walking a whole volume to act on none of it.
        /// </summary>
        public static string? DescribeRootRefusal(string? root)
        {
            if (!TryReadPath(root, out var volume, out var components, out var refusal)) return refusal;

            // Asked before the depth floor so a vault path gets the reason that actually applies to
            // it rather than an incidental complaint about how many folders it has.
            var overlap = DescribeVaultOverlap(volume, components);
            if (overlap != null) return overlap;

            return components.Count < MinRootComponents
                ? $"it is only {components.Count} folder(s) below its volume, and a root that shallow " +
                  $"confines writes to little more than the whole drive (at least {MinRootComponents} required)"
                : null;
        }

        /// <summary>
        /// Refuse a root that overlaps the production vault anywhere except the fixture folder.
        ///
        /// <see cref="MinRootComponents"/> is a heuristic about shape, and a root's shape is not
        /// what makes it safe. <c>C:\BluePLM\br-vault\Engineering</c> is absolute, canonical, free
        /// of reparse points and three folders below its volume, and it authorises a write to every
        /// production document under it. No floor refuses that without also refusing a legitimate
        /// sandbox of the same depth, so the guard names the vault and asks the question directly.
        ///
        /// <see cref="DefaultFixtureRoot"/> and anything below it stay allowed - that subtree is
        /// what the fixture suite exists to write to. Anything outside the vault is not this
        /// check's business and is left to the rules above.
        /// </summary>
        private static string? DescribeVaultOverlap(string volume, List<string> components)
        {
            if (!IsAtOrBelow(volume, components, ProductionVaultRoot)) return null;
            if (IsAtOrBelow(volume, components, DefaultFixtureRoot)) return null;

            return $"it is inside the production vault at '{ProductionVaultRoot}' but not inside " +
                   $"'{DefaultFixtureRoot}', so it would authorise writes to production documents";
        }

        /// <summary>
        /// Whether <paramref name="volume"/> and <paramref name="components"/> name
        /// <paramref name="ancestor"/> itself or something below it.
        ///
        /// An unparseable ancestor answers false rather than throwing. Both callers pass a
        /// compile-time constant of the required shape, so that branch is unreachable today; it is
        /// written this way so a future typo in one of those constants widens nothing silently -
        /// the containment rules in <see cref="FindRefusal"/> still apply on their own.
        /// </summary>
        private static bool IsAtOrBelow(string volume, List<string> components, string ancestor)
        {
            if (!TryReadPath(ancestor, out var ancestorVolume, out var ancestorComponents, out _)) return false;
            if (!Same(volume, ancestorVolume)) return false;
            if (components.Count < ancestorComponents.Count) return false;

            for (var index = 0; index < ancestorComponents.Count; index++)
            {
                if (!Same(components[index], ancestorComponents[index])) return false;
            }

            return true;
        }

        /// <summary>
        /// Whether <paramref name="candidate"/> is <paramref name="root"/> or something proven to be
        /// beneath it. See the type's remarks for what has to hold for the answer to be true.
        /// </summary>
        public static bool IsInside(string? candidate, string? root) => FindRefusal(candidate, root) == null;

        /// <summary>
        /// Explains a refusal, for a diagnostic that has to tell its operator why it did nothing.
        /// </summary>
        public static string DescribeRefusal(string? candidate, string? root)
        {
            var refusal = FindRefusal(candidate, root);

            return refusal == null
                ? $"'{candidate}' does resolve to a location inside '{root}'."
                : $"'{candidate}' is not allowed inside '{root}': {refusal}";
        }

        /// <summary>The reason to refuse, or null when there is none.</summary>
        private static string? FindRefusal(string? candidate, string? root)
        {
            var rootRefusal = DescribeRootRefusal(root);
            if (rootRefusal != null)
                return $"the allowed root cannot be used as a boundary - {rootRefusal}";

            // Already known to succeed: DescribeRootRefusal ran it.
            TryReadPath(root, out var rootVolume, out var rootComponents, out _);

            if (!TryReadPath(candidate, out var volume, out var components, out var refusal))
                return refusal;

            if (!Same(volume, rootVolume))
                return $"it is on '{volume}' and the root is on '{rootVolume}'";

            if (components.Count < rootComponents.Count)
                return "it is above the root rather than inside it";

            for (var index = 0; index < rootComponents.Count; index++)
            {
                if (!Same(components[index], rootComponents[index]))
                    return $"its '{components[index]}' component is not the root's '{rootComponents[index]}'";
            }

            var depth = components.Count - rootComponents.Count;
            if (depth > MaxDepthBelowRoot)
                return $"it is {depth} levels below the root, and a fixture is never more than {MaxDepthBelowRoot}";

            return FindReparsePoint(volume, components) ?? FindExtraHardLink(Join(volume, components));
        }

        /// <summary>
        /// Split an absolute path into its volume and the named components below it, refusing any
        /// shape whose meaning is not settled by the text alone.
        ///
        /// Three rewrites are permitted, because each is lossless and cannot change which file is
        /// named: forward slashes count as separators, runs of separators count as one, and a
        /// trailing separator is dropped. Everything else has to be literal.
        /// </summary>
        private static bool TryReadPath(string? path, out string volume, out List<string> components, out string refusal)
        {
            volume = string.Empty;
            components = new List<string>();

            if (string.IsNullOrWhiteSpace(path))
            {
                refusal = "it is empty";
                return false;
            }

            var text = path!.Replace(Path.AltDirectorySeparatorChar, Path.DirectorySeparatorChar);

            if (text.StartsWith(@"\\?\", StringComparison.Ordinal) || text.StartsWith(@"\\.\", StringComparison.Ordinal))
            {
                refusal = "it uses the extended-length or device prefix, which switches off the path " +
                          "normalisation the rest of this guard depends on - Windows leaves '..' in such " +
                          "a path unresolved";
                return false;
            }

            int belowVolume;
            if (text.StartsWith(@"\\", StringComparison.Ordinal))
            {
                // \\server\share is the volume. Anything shorter names nothing to be inside of.
                var afterServer = text.IndexOf(Path.DirectorySeparatorChar, 2);
                if (afterServer < 0 || afterServer == 2)
                {
                    refusal = "it names no server and share";
                    return false;
                }

                var afterShare = text.IndexOf(Path.DirectorySeparatorChar, afterServer + 1);
                var volumeEnd = afterShare < 0 ? text.Length : afterShare;
                if (volumeEnd <= afterServer + 1)
                {
                    refusal = "it names a server but no share";
                    return false;
                }

                volume = text.Substring(0, volumeEnd);
                belowVolume = volumeEnd;
            }
            else if (text.Length >= 3 && IsDriveLetter(text[0]) && text[1] == ':' && text[2] == Path.DirectorySeparatorChar)
            {
                volume = text.Substring(0, 3);
                belowVolume = 3;
            }
            else
            {
                refusal = "it is not an absolute path on a named volume, so its meaning would depend on " +
                          "the process working directory rather than on the path itself";
                return false;
            }

            foreach (var component in text.Substring(belowVolume).Split(Separators, StringSplitOptions.RemoveEmptyEntries))
            {
                var componentRefusal = InspectComponent(component);
                if (componentRefusal != null)
                {
                    refusal = componentRefusal;
                    return false;
                }

                components.Add(component);

                if (components.Count > MaxPathComponents)
                {
                    refusal = $"it has more than {MaxPathComponents} components";
                    return false;
                }
            }

            refusal = string.Empty;
            return true;
        }

        /// <summary>Why one component makes the path unusable, or null when it does not.</summary>
        private static string? InspectComponent(string component)
        {
            if (component == "." || component == "..")
            {
                return $"it contains a '{component}' segment, and the guard deliberately does not " +
                       "resolve those - a path has to arrive already canonical";
            }

            foreach (var character in component)
            {
                if (character < ' ')
                    return $"its '{component}' component contains a control character";
            }

            var forbidden = component.IndexOfAny(ForbiddenInComponent);
            if (forbidden >= 0)
                return $"its '{component}' component contains '{component[forbidden]}', which no file name may";

            var last = component[component.Length - 1];
            if (last == '.' || last == ' ')
            {
                return $"its '{component}' component ends in {(last == ' ' ? "a space" : "a dot")}, which " +
                       "Windows strips, so the name is an alias for a different one";
            }

            if (LooksLikeShortName(component))
            {
                return $"its '{component}' component is an 8.3 short name, which is an alias for a longer " +
                       "name and cannot be compared against the root as written";
            }

            return null;
        }

        /// <summary>
        /// PROGRA~1, 00-REG~1: at most eight characters ending in a tilde and digits, and at most a
        /// three character extension.
        ///
        /// The leading tilde is required to be part of a longer stem, which is what keeps the
        /// SolidWorks leftovers the sweeper has to recognise - ~$PART.SLDPRT, PART.~sldprt - out of
        /// this. Their extensions are six characters long and their tildes lead.
        /// </summary>
        private static bool LooksLikeShortName(string component)
        {
            var dot = component.LastIndexOf('.');
            var stem = dot < 0 ? component : component.Substring(0, dot);
            var extension = dot < 0 ? string.Empty : component.Substring(dot + 1);

            if (stem.Length == 0 || stem.Length > 8 || extension.Length > 3) return false;
            if (stem.IndexOf('.') >= 0) return false;

            var tilde = stem.LastIndexOf('~');
            if (tilde <= 0 || tilde == stem.Length - 1) return false;

            for (var index = tilde + 1; index < stem.Length; index++)
            {
                if (!char.IsDigit(stem[index])) return false;
            }

            return true;
        }

        /// <summary>
        /// Walk the volume root, then every component down to the candidate, looking for a reparse
        /// point. The allowed root and everything above it are included on purpose: a junction there
        /// redirects the entire fixture folder, which is the one case this guard exists to catch, and
        /// an earlier version stopped the walk the moment it reached the root and so never looked.
        /// </summary>
        private static string? FindReparsePoint(string volume, List<string> components)
        {
            var path = volume;

            for (var index = 0; ; index++)
            {
                switch (ReadAttributes(path, out var attributes, out var error))
                {
                    case Probe.Unreadable:
                        return $"the guard cannot read the attributes of '{path}' ({error}), so it cannot " +
                               "rule out a junction there";

                    case Probe.Absent:
                        // Nothing below an absent directory exists either, so nothing left can redirect.
                        return null;
                }

                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    return $"'{path}' is a junction or a symbolic link, so the path does not stay where " +
                           "its name says it does";
                }

                if (index >= components.Count) return null;

                path = Append(path, components[index]);
            }
        }

        /// <summary>
        /// Refuse a file that the volume knows by more than one name.
        ///
        /// Every check above reasons about the shape of a path, and a hard link is the one alias
        /// whose shape is genuine. It sets no ReparsePoint attribute and reads back as an ordinary
        /// file, so a link planted inside the root walks the checks above unchallenged while the
        /// bytes it opens are a production document with a second directory entry anywhere else on
        /// the volume. Proving the name is inside the root proves nothing about the file.
        ///
        /// The evidence the shape cannot supply is the link count, which is the number of directory
        /// entries the volume has for these bytes. More than one means containment of the name does
        /// not bound what a write reaches, and the guard refuses what it cannot prove. A link whose
        /// other names all happen to be inside the root is refused too: no fixture has that shape,
        /// and admitting it would mean enumerating where the other names are, which is a far more
        /// expensive question than this one.
        ///
        /// Directories are exempt because NTFS does not hard link them. The directory equivalent is
        /// a junction, and <see cref="FindReparsePoint"/> has already refused those.
        ///
        /// A file system that does not report link counts - a network share, most notably - answers
        /// one for everything. That is no weaker than the guard was before this check existed, and a
        /// share cannot be the fixture root in any case: <see cref="DefaultFixtureRoot"/> is a local
        /// path and a candidate on another volume is refused long before reaching here.
        /// </summary>
        private static string? FindExtraHardLink(string path)
        {
            using (var handle = CreateFile(
                       path,
                       FileReadAttributes,
                       ShareAll,
                       IntPtr.Zero,
                       OpenExisting,
                       FileFlagBackupSemantics,
                       IntPtr.Zero))
            {
                if (handle.IsInvalid)
                {
                    var error = Marshal.GetLastWin32Error();

                    // Nothing there has no second name, which is the same verdict the walk above
                    // reaches for an absent path.
                    if (error == ErrorFileNotFound || error == ErrorPathNotFound) return null;

                    return $"the guard cannot open '{path}' to count its names (Win32 error {error}), " +
                           "so it cannot rule out a hard link to a file outside the root";
                }

                if (!GetFileInformationByHandle(handle, out var information))
                {
                    return $"the guard cannot read how many names '{path}' has (Win32 error " +
                           $"{Marshal.GetLastWin32Error()}), so it cannot rule out a hard link to a " +
                           "file outside the root";
                }

                if ((information.FileAttributes & DirectoryAttribute) != 0) return null;

                return information.NumberOfLinks > 1
                    ? $"'{path}' is one of {information.NumberOfLinks} names this volume has for the same " +
                      "file, so proving this name is inside the root does not prove the file is"
                    : null;
            }
        }

        /// <summary>Rejoin a volume and its components into the path they were read from.</summary>
        private static string Join(string volume, List<string> components)
        {
            var path = volume;

            foreach (var component in components)
            {
                path = Append(path, component);
            }

            return path;
        }

        private static string Append(string path, string component) =>
            path.EndsWith(SeparatorText, StringComparison.Ordinal)
                ? path + component
                : path + SeparatorText + component;

        /// <summary>
        /// Attributes, absence, and "cannot tell" kept apart on purpose.
        ///
        /// An earlier version asked File.Exists and Directory.Exists first and returned "not a
        /// reparse point" when both said no. Both of them answer no for a directory the process is
        /// not allowed to look at, which quietly turned an unreadable ancestor into a safe one and
        /// left the catch below unreachable for the case it was written for.
        /// </summary>
        private static Probe ReadAttributes(string path, out FileAttributes attributes, out string error)
        {
            attributes = default(FileAttributes);
            error = string.Empty;

            try
            {
                attributes = File.GetAttributes(path);
                return Probe.Readable;
            }
            catch (FileNotFoundException)
            {
                return Probe.Absent;
            }
            catch (DirectoryNotFoundException)
            {
                return Probe.Absent;
            }
            catch (Exception failure)
            {
                error = failure.GetType().Name;
                return Probe.Unreadable;
            }
        }

        private static bool IsDriveLetter(char character) =>
            (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');

        private static bool Same(string left, string right) =>
            string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// Enough access to read metadata and nothing more. An open for FILE_READ_ATTRIBUTES alone
        /// is exempt from sharing violations, so counting a document's names never fails merely
        /// because SolidWorks has it open.
        /// </summary>
        private const uint FileReadAttributes = 0x0080;

        /// <summary>Deny nothing: this handle only reads metadata and must not block other openers.</summary>
        private const uint ShareAll = 0x00000001 | 0x00000002 | 0x00000004;

        private const uint OpenExisting = 3;

        /// <summary>Required to open a directory handle at all, which the guard needs to exempt them.</summary>
        private const uint FileFlagBackupSemantics = 0x02000000;

        private const uint DirectoryAttribute = 0x00000010;

        private const int ErrorFileNotFound = 2;

        private const int ErrorPathNotFound = 3;

        /// <summary>
        /// The link count is not exposed by System.IO on .NET Framework, and
        /// <c>FindFirstFileName</c> would enumerate names the guard does not need. One handle and
        /// one query answers the only question asked: is this count above one.
        /// </summary>
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
        private static extern SafeFileHandle CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);

        /// <summary>Win32 <c>BY_HANDLE_FILE_INFORMATION</c>. Laid out in full because the fields are positional.</summary>
        [StructLayout(LayoutKind.Sequential)]
        private struct FileInformation
        {
            public uint FileAttributes;
            public FileTime CreationTime;
            public FileTime LastAccessTime;
            public FileTime LastWriteTime;
            public uint VolumeSerialNumber;
            public uint FileSizeHigh;
            public uint FileSizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        /// <summary>Win32 <c>FILETIME</c>. Present only to give the struct above its correct size.</summary>
        [StructLayout(LayoutKind.Sequential)]
        private struct FileTime
        {
            public uint Low;
            public uint High;
        }
    }
}
