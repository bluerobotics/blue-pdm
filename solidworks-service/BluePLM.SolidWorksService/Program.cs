using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// BluePLM SolidWorks Service
    /// 
    /// A command-line service that processes JSON commands from the Electron app
    /// to interact with SolidWorks files.
    /// 
    /// KEY ARCHITECTURE:
    /// 
    /// FAST operations (Document Manager API - NO SolidWorks launch!):
    ///   - getBom, getProperties, setProperties, getConfigurations, getReferences, getPreview
    ///   - Requires a DM license key (free with SW subscription)
    /// 
    /// SLOW operations (Full SolidWorks API - launches SW):
    ///   - getMassProperties (needs rebuild)
    ///   - exportPdf, exportStep, exportIges, exportDxf, exportImage
    ///   - replaceComponent, packAndGo
    /// 
    /// Communication protocol:
    /// - Input: JSON commands on stdin, one per line
    /// - Output: JSON responses on stdout, one per line
    /// </summary>
    class Program
    {
        /// <summary>
        /// Service version - bump this when making changes that affect functionality.
        /// The app checks this version and warns if there's a mismatch.
        /// </summary>
        private const string SERVICE_VERSION = "1.18.0";

        /// <summary>
        /// JSON settings for all stdout responses. EscapeNonAscii forces every non-ASCII character
        /// (e.g. the diameter sign, GD&amp;T symbols, tolerance glyphs) to a \uXXXX escape so the
        /// payload is pure ASCII. This survives any Windows console/stdout code page and is parsed
        /// back to the correct Unicode by the Electron side, preventing "?" replacement characters.
        /// </summary>
        private static readonly JsonSerializerSettings ResponseJsonSettings = new JsonSerializerSettings
        {
            StringEscapeHandling = StringEscapeHandling.EscapeNonAscii,
        };


        private static DocumentManagerAPI? _dmApi;
        private static SolidWorksAPI? _swApi;
        private static ComStabilityLayer? _comStability;
        
        /// <summary>
        /// When true, enables detailed diagnostic logging for debugging.
        /// Set via --verbose command line argument.
        /// </summary>
        public static bool VerboseLogging { get; private set; } = false;

        static int Main(string[] args)
        {
            // Emit stdout/stderr as UTF-8 so Unicode (diameter sign, GD&T symbols, etc.) is not
            // mangled by the default Windows console code page. Combined with EscapeNonAscii on the
            // JSON responses, this guarantees non-ASCII characters reach the app intact.
            try
            {
                Console.OutputEncoding = new UTF8Encoding(false);
                Console.InputEncoding = new UTF8Encoding(false);
            }
            catch { /* Non-fatal: EscapeNonAscii still keeps responses ASCII-safe */ }

            // Catch ALL unhandled exceptions to prevent silent crashes
            AppDomain.CurrentDomain.UnhandledException += (sender, e) =>
            {
                var ex = e.ExceptionObject as Exception;
                Console.Error.WriteLine($"[FATAL] Unhandled exception: {ex?.Message}");
                Console.Error.WriteLine($"[FATAL] Stack trace: {ex?.StackTrace}");
                if (ex?.InnerException != null)
                {
                    Console.Error.WriteLine($"[FATAL] Inner exception: {ex.InnerException.Message}");
                }
                Console.Error.Flush();
            };

            bool keepSwRunning = true;
            bool singleCommand = false;
            string? commandJson = null;
            string? dmLicenseKey = null;
            string? swProgId = null;
            string? probeFilePath = null;
            string? probeConfiguration = null;
            bool probeAllowWrite = false;
            bool probeReadOnlyAttribute = false;
            bool probeReferences = false;

            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--close-sw-after":
                        keepSwRunning = false;
                        break;
                    case "--command":
                        singleCommand = true;
                        if (i + 1 < args.Length)
                            commandJson = args[++i];
                        break;
                    case "--dm-license":
                        if (i + 1 < args.Length)
                            dmLicenseKey = args[++i];
                        break;
                    case "--sw-progid":
                        if (i + 1 < args.Length)
                            swProgId = args[++i];
                        break;
                    case "--dm-probe":
                        if (i + 1 < args.Length)
                            probeFilePath = args[++i];
                        break;
                    case "--probe-config":
                        if (i + 1 < args.Length)
                            probeConfiguration = args[++i];
                        break;
                    case "--allow-write":
                        probeAllowWrite = true;
                        break;
                    case "--probe-readonly":
                        probeReadOnlyAttribute = true;
                        break;
                    case "--probe-references":
                        probeReferences = true;
                        break;
                    case "--help":
                        PrintUsage();
                        return 0;
                    case "--verbose":
                        VerboseLogging = true;
                        break;
                }
            }

            SolidWorksComRegistry.SetPreferredProgId(swProgId);

            // The probe is a self-contained diagnostic. It must run before any of the startup below,
            // which creates SolidWorks-facing objects the probe deliberately avoids.
            if (probeFilePath != null)
            {
                // RegressionFixtureGuard judges absolute, already-canonical paths only, and will not
                // resolve a relative one: a guard whose verdict changes with the working directory is
                // not a guard. Turning what the operator typed into such a path belongs here, at the
                // edge, where the working directory is a legitimate part of the request.
                try
                {
                    probeFilePath = Path.GetFullPath(probeFilePath);
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine($"--dm-probe: '{probeFilePath}' is not a usable path ({error.Message})");
                    return 1;
                }

                return DmWriteProbe.Run(new ProbeOptions
                {
                    FilePath = probeFilePath,
                    Configuration = probeConfiguration,
                    LicenseKey = dmLicenseKey,
                    AllowWrite = probeAllowWrite,
                    ProbeReadOnly = probeReadOnlyAttribute,
                    ProbeReferences = probeReferences,
                });
            }

            // Initialize Document Manager API (for FAST operations - no SW launch!)
            Console.Error.WriteLine("=== BluePLM SolidWorks Service Startup ===");
            Console.Error.WriteLine($"[Startup] DM License key from command line: {(dmLicenseKey == null ? "not provided" : "provided")}");
            Console.Error.WriteLine($"[Startup] Verbose logging: {(VerboseLogging ? "enabled" : "disabled")}");
            Console.Error.WriteLine($"[Startup] Preferred SolidWorks ProgID: {swProgId ?? "(machine default)"}");
            Console.Error.WriteLine($"[Startup] Registered SolidWorks installs: {SolidWorksComRegistry.DescribeInstalls()}");

            // Initialize COM Stability Layer FIRST (before any COM operations)
            Console.Error.WriteLine("[Startup] Creating ComStabilityLayer instance...");
            _comStability = new ComStabilityLayer();
            var comInitResult = _comStability.Initialize();
            Console.Error.WriteLine($"[Startup] ComStabilityLayer initialized: {comInitResult}");
            Console.Error.WriteLine($"[Startup] IMessageFilter registered: {_comStability.IsMessageFilterRegistered}");
            
            Console.Error.WriteLine("[Startup] Creating DocumentManagerAPI instance...");
            _dmApi = new DocumentManagerAPI(dmLicenseKey);
            
            Console.Error.WriteLine("[Startup] Calling Initialize()...");
            var initResult = _dmApi.Initialize(); // Try to init, may fail if no license key
            Console.Error.WriteLine($"[Startup] Initialize() returned: {initResult}");
            Console.Error.WriteLine($"[Startup] IsAvailable: {_dmApi.IsAvailable}");
            Console.Error.WriteLine($"[Startup] InitializationError: {_dmApi.InitializationError ?? "(none)"}");
            
            // Initialize SolidWorks API handler (for exports - launches SW on demand)
            // Pass the COM stability layer for wrapped COM operations
            Console.Error.WriteLine("[Startup] Creating SolidWorksAPI instance...");
            _swApi = new SolidWorksAPI(keepSwRunning, _comStability);
            Console.Error.WriteLine($"[Startup] SolidWorks available: {_swApi.IsSolidWorksAvailable()}");

            // Single command mode
            if (singleCommand && commandJson != null && commandJson.Length > 0)
            {
                var result = ProcessCommand(commandJson);
                Console.WriteLine(JsonConvert.SerializeObject(result, ResponseJsonSettings));
                return result.Success ? 0 : 1;
            }

            // Interactive mode - read commands from stdin
            var dmStatus = _dmApi.IsAvailable ? "[OK] READY (fast mode enabled)" : $"[FAIL] {_dmApi.InitializationError}";
            Console.Error.WriteLine("=== Service Ready ===");
            Console.Error.WriteLine($"BluePLM SolidWorks Service v{SERVICE_VERSION}");
            Console.Error.WriteLine($"  Document Manager API: {dmStatus}");
            Console.Error.WriteLine("  Full SolidWorks API: launches on demand for exports");
            Console.Error.WriteLine("Ready for commands...");
            
            string? line;
            try
            {
                while ((line = Console.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    
                    // Extract action to determine if this is a quiet polling operation
                    string? action = null;
                    try
                    {
                        var parsed = JsonConvert.DeserializeObject<JObject>(line);
                        action = parsed?["action"]?.ToString();
                    }
                    catch { /* Ignore parse errors here, will be handled in ProcessCommand */ }
                    
                    bool isQuietOperation = action == "ping" || action == "getSelectedFiles";
                    
                    if (!isQuietOperation)
                    {
                        Console.Error.WriteLine($"[Service] Received command: {line.Substring(0, Math.Min(50, line.Length))}...");
                    }
                    
                    // Extract requestId BEFORE calling ProcessCommand so we can include it in error responses
                    int? requestIdForErrorHandling = null;
                    try
                    {
                        // Pre-parse requestId for error handling (best effort)
                        var preParseCmd = JsonConvert.DeserializeObject<JObject>(line);
                        requestIdForErrorHandling = preParseCmd?["requestId"]?.Value<int>();
                    }
                    catch { /* Ignore parse errors - ProcessCommand will handle them */ }
                    
                    try
                    {
                        var result = ProcessCommand(line);
                        var response = JsonConvert.SerializeObject(result, ResponseJsonSettings);
                        if (!isQuietOperation)
                        {
                            Console.Error.WriteLine($"[Service] Sending response ({response.Length} chars)");
                        }
                        Console.WriteLine(response);
                        Console.Out.Flush();
                        if (!isQuietOperation)
                        {
                            Console.Error.WriteLine("[Service] Response sent, waiting for next command...");
                        }
                    }
                    catch (Exception ex)
                    {
                        // #region agent log - Service exception
                        Console.Error.WriteLine($"[Service] [DEBUG] UNHANDLED_EXCEPTION: requestId={requestIdForErrorHandling}, error={ex.Message}");
                        Console.Error.WriteLine($"[Service] [DEBUG] Stack: {ex.StackTrace}");
                        // #endregion
                        Console.Error.WriteLine($"[Service] Exception processing command: {ex.Message}");
                        var error = new CommandResult
                        {
                            Success = false,
                            Error = $"Unhandled error: {ex.Message}",
                            ErrorDetails = ex.ToString(),
                            // CRITICAL: Include requestId so frontend can match this error to the correct request
                            RequestId = requestIdForErrorHandling
                        };
                        Console.WriteLine(JsonConvert.SerializeObject(error, ResponseJsonSettings));
                        Console.Out.Flush();
                    }
                }
                Console.Error.WriteLine("[Service] stdin closed (ReadLine returned null), exiting...");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Service] Exception in main loop: {ex.Message}");
                Console.Error.WriteLine($"[Service] Stack: {ex.StackTrace}");
            }

            Console.Error.WriteLine("[Service] Cleaning up...");
            _dmApi?.Dispose();
            _swApi?.Dispose();
            _comStability?.Dispose();
            Console.Error.WriteLine("[Service] Cleanup complete, exiting with code 0");

            return 0;
        }

        /// <summary>
        /// Helper to wrap operations that require full SolidWorks installation.
        /// Returns a clear error if SolidWorks is not available.
        /// </summary>
        static CommandResult RequiresSolidWorks(Func<CommandResult> operation, string operationName)
        {
            if (_swApi == null || !_swApi.IsSolidWorksAvailable())
            {
                return new CommandResult 
                { 
                    Success = false, 
                    Error = $"This operation requires SolidWorks to be installed",
                    ErrorCode = "SW_NOT_INSTALLED",
                    ErrorDetails = $"The '{operationName}' operation requires a full SolidWorks installation. " +
                                   "Document Manager-only mode does not support exports, mass properties, or document management features."
                };
            }
            return operation();
        }

        static CommandResult ProcessCommand(string json)
        {
            int? requestId = null;
            try
            {
                var command = JsonConvert.DeserializeObject<JObject>(json);
                if (command == null)
                    return new CommandResult { Success = false, Error = "Invalid JSON" };

                // Extract requestId for response correlation
                requestId = command["requestId"]?.Value<int>();

                var action = command["action"]?.ToString();
                var filePath = command["filePath"]?.ToString();

                if (string.IsNullOrEmpty(action))
                    return new CommandResult { Success = false, Error = "Missing 'action' field", RequestId = requestId };

                var result = action switch
                {
                    // ========================================
                    // FAST operations (Document Manager API)
                    // NO SolidWorks launch - instant!
                    // ========================================
                    
                    "getBom" => GetBomFast(filePath, command),
                    "getProperties" => GetPropertiesFast(filePath, command),
                    "getConfigurations" => GetConfigurationsFast(filePath),
                    "getReferences" => GetReferencesFast(filePath, ReadReferenceOrigin(command)),
                    "getPreview" => GetPreviewFast(filePath, command["configuration"]?.ToString()),
                    "getShellThumbnail" => WindowsShellThumbnail.GetThumbnail(filePath!, 
                        command["size"]?.Value<int>() ?? 256),
                    
                    // ========================================
                    // File Lock Detection (Windows Restart Manager API)
                    // Does NOT require SolidWorks - pure Windows API
                    // ========================================
                    
                    "findLockingProcesses" => SolidWorksAPI.FindLockingProcesses(filePath),
                    
                    // ========================================
                    // Open Document Management
                    // Control documents open in running SolidWorks
                    // Requires full SolidWorks installation
                    // ========================================
                    
                    "getOpenDocuments" => RequiresSolidWorks(() => _swApi!.GetOpenDocuments(
                        command["includeComponents"]?.Value<bool>() ?? false), "getOpenDocuments"),
                    "isDocumentOpen" => RequiresSolidWorks(() => _swApi!.IsDocumentOpen(filePath), "isDocumentOpen"),
                    "getDocumentInfo" => RequiresSolidWorks(() => _swApi!.GetDocumentInfo(filePath), "getDocumentInfo"),
                    "setDocumentReadOnly" => RequiresSolidWorks(() => _swApi!.SetDocumentReadOnly(filePath,
                        command["readOnly"]?.Value<bool>() ?? true), "setDocumentReadOnly"),
                    "saveDocument" => RequiresSolidWorks(() => _swApi!.SaveDocument(filePath), "saveDocument"),
                    "setDocumentProperties" => RequiresSolidWorks(() => _swApi!.SetDocumentProperties(filePath,
                        command["properties"]?.ToObject<System.Collections.Generic.Dictionary<string, string>>(),
                        command["configuration"]?.ToString()), "setDocumentProperties"),
                    "getSelectedFiles" => RequiresSolidWorks(() => _swApi!.GetSelectedFiles(), "getSelectedFiles"),
                    
                    // ========================================
                    // SLOW operations (Full SolidWorks API)
                    // Launches SolidWorks when needed
                    // ========================================
                    
                    // setProperties uses DM API first, falls back to SW API if needed
                    "setProperties" => SetPropertiesFast(filePath, 
                        command["properties"]?.ToObject<System.Collections.Generic.Dictionary<string, string>>(),
                        command["configuration"]?.ToString()),
                    "setPropertiesBatch" => SetPropertiesBatchFast(filePath,
                        command["configProperties"]?.ToObject<System.Collections.Generic.Dictionary<string, System.Collections.Generic.Dictionary<string, string>>>()),
                    
                    // getMassProperties requires full SolidWorks (needs rebuild)
                    "getMassProperties" => RequiresSolidWorks(() => _swApi!.GetMassProperties(filePath,
                        command["configuration"]?.ToString()), "getMassProperties"),

                    // getInspectionCharacteristics reads the SOLIDWORKS Inspection add-in's
                    // Bill of Characteristics from a drawing (requires full SW + Inspection add-in)
                    "getInspectionCharacteristics" => RequiresSolidWorks(
                        () => _swApi!.GetInspectionCharacteristics(filePath), "getInspectionCharacteristics"),

                    // setInspectionCharacteristics (EXPERIMENTAL) writes bluePLM inspection metadata
                    // back into the drawing's Bill of Characteristics (requires full SW + Inspection add-in)
                    "setInspectionCharacteristics" => RequiresSolidWorks(
                        () => _swApi!.SetInspectionCharacteristics(filePath,
                            command["characteristics"]?.ToObject<System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, string>>>()),
                        "setInspectionCharacteristics"),
                    
                    // Exports (require full SW)
                    "exportPdf" => RequiresSolidWorks(() => _swApi!.ExportToPdf(filePath, 
                        command["outputPath"]?.ToString(),
                        command["filenamePattern"]?.ToString(),
                        command["pdmMetadata"]?.ToObject<PdmMetadata>()), "exportPdf"),
                    "exportStep" => RequiresSolidWorks(() => _swApi!.ExportToStep(filePath,
                        command["outputPath"]?.ToString(),
                        command["configuration"]?.ToString(),
                        command["exportAllConfigs"]?.Value<bool>() ?? false,
                        command["configurations"]?.ToObject<string[]>(),
                        command["filenamePattern"]?.ToString(),
                        command["pdmMetadata"]?.ToObject<PdmMetadata>()), "exportStep"),
                    "exportStl" => RequiresSolidWorks(() => _swApi!.ExportToStl(filePath,
                        command["outputPath"]?.ToString(),
                        command["configuration"]?.ToString(),
                        command["exportAllConfigs"]?.Value<bool>() ?? false,
                        command["configurations"]?.ToObject<string[]>(),
                        command["resolution"]?.ToString() ?? "fine",
                        command["binaryFormat"]?.Value<bool>() ?? true,
                        command["customDeviation"]?.Value<double>(),
                        command["customAngle"]?.Value<double>(),
                        command["filenamePattern"]?.ToString(),
                        command["pdmMetadata"]?.ToObject<PdmMetadata>()), "exportStl"),
                    "exportIges" => RequiresSolidWorks(() => _swApi!.ExportToIges(filePath,
                        command["outputPath"]?.ToString()), "exportIges"),
                    "exportDxf" => RequiresSolidWorks(() => _swApi!.ExportToDxf(filePath,
                        command["outputPath"]?.ToString()), "exportDxf"),
                    "exportImage" => RequiresSolidWorks(() => _swApi!.ExportToImage(filePath,
                        command["outputPath"]?.ToString(),
                        command["width"]?.Value<int>() ?? 800,
                        command["height"]?.Value<int>() ?? 600), "exportImage"),
                    
                    // Document creation (requires full SW)
                    "createDocumentFromTemplate" => RequiresSolidWorks(() => _swApi!.CreateDocumentFromTemplate(
                        command["templatePath"]?.ToString(),
                        command["outputPath"]?.ToString()), "createDocumentFromTemplate"),
                    
                    // Assembly operations (require full SW)
                    "replaceComponent" => RequiresSolidWorks(() => _swApi!.ReplaceComponent(filePath,
                        command["oldComponent"]?.ToString(),
                        command["newComponent"]?.ToString()), "replaceComponent"),
                    "packAndGo" => RequiresSolidWorks(() => _swApi!.PackAndGo(filePath,
                        command["outputFolder"]?.ToString(),
                        command["prefix"]?.ToString(),
                        command["suffix"]?.ToString()), "packAndGo"),

                    // Duplication with reference remapping. Not wrapped in RequiresSolidWorks:
                    // the Document Manager path works without a SolidWorks installation.
                    "duplicateWithReferences" => DuplicateWithReferences(
                        command["sourceModelPath"]?.ToString(),
                        command["targetModelPath"]?.ToString(),
                        command["sourceDrawingPath"]?.ToString(),
                        command["targetDrawingPath"]?.ToString()),
                    "addComponent" => RequiresSolidWorks(() => _swApi!.AddComponent(filePath,
                        command["componentPath"]?.ToString(),
                        command["coordinates"]?.ToObject<double[]>()), "addComponent"),
                    
                    // warmup pre-launches a hidden SolidWorks instance so the first write
                    // operation (setProperties) doesn't pay the cold-start cost. No-op if already running.
                    "warmup" => RequiresSolidWorks(() => _swApi!.EnsureRunning(), "warmup"),

                    // Service control
                    "ping" => Ping(),
                    "setDmLicense" => SetDmLicense(command["licenseKey"]?.ToString()),
                    "releaseHandles" => ReleaseHandles(),
                    "resetComConnection" => ResetComConnection(),
                    "quit" => Quit(),
                    
                    _ => new CommandResult { Success = false, Error = $"Unknown action: {action}" }
                };

                // Set requestId on result for response correlation
                result.RequestId = requestId;
                return result;
            }
            catch (JsonException ex)
            {
                return new CommandResult { Success = false, Error = $"JSON parse error: {ex.Message}", RequestId = requestId };
            }
            catch (SolidWorksComInaccessibleException ex)
            {
                return new CommandResult
                {
                    Success = false,
                    Error = SolidWorksComInaccessibleException.Code,
                    Data = new { message = ex.Message },
                    RequestId = requestId,
                };
            }
        }

        // ========================================
        // FAST operations - use DM API only, NEVER fall back to SW API
        // Launching SolidWorks is too slow/disruptive for background operations
        // ========================================

        static CommandResult GetBomFast(string? filePath, JObject command)
        {
            // If SolidWorks has this file open, use full SW API to avoid DM API conflict
            // (DM API accessing a file open in SW can cause SW to close the file)
            if (_swApi != null && !string.IsNullOrEmpty(filePath) && _swApi.IsFileOpenInSolidWorks(filePath!))
            {
                Console.Error.WriteLine($"[Service] File is open in SolidWorks, using SW API: {Path.GetFileName(filePath)}");
                return _swApi.GetBillOfMaterials(filePath, 
                    command["includeChildren"]?.Value<bool>() ?? true,
                    command["configuration"]?.ToString());
            }
            
            // Use Document Manager API ONLY - NEVER fall back to full SW API
            // Note: We only check for null here. The DM methods internally call Initialize()
            // which handles reinitialization after ReleaseHandles() was called.
            if (_dmApi == null)
            {
                Console.Error.WriteLine($"[Service] Document Manager API not created for: {Path.GetFileName(filePath)}");
                return new CommandResult 
                { 
                    Success = false, 
                    Error = "Document Manager not available. Configure DM license in Settings -> Integrations -> SOLIDWORKS." 
                };
            }
            
            var result = _dmApi.GetBillOfMaterials(filePath, command["configuration"]?.ToString());
            if (!result.Success)
            {
                Console.Error.WriteLine($"[Service] DM API failed for getBom: {result.Error}");
            }
            return result;  // Return DM result - no fallback to SW API!
        }

        /// <summary>
        /// Perform a read through the full SolidWorks API when SolidWorks has the file open,
        /// returning null when the caller should use Document Manager instead.
        ///
        /// IsFileOpenInSolidWorks answers "assume open" whenever COM is unreachable, because
        /// pointing Document Manager at a document SolidWorks really has open can make
        /// SolidWorks close it. That guess must not be terminal: if COM is unreachable then
        /// SolidWorks is not reachable to be holding anything on our behalf, the SolidWorks API
        /// can only fail, and Document Manager is both safe and the only path that can answer.
        /// A failure for any other reason still propagates to the caller unchanged.
        /// </summary>
        static CommandResult? TryReadWhileOpenInSolidWorks(
            string? filePath,
            Func<string, CommandResult?> read)
        {
            if (_swApi == null || string.IsNullOrEmpty(filePath)) return null;
            if (!_swApi.IsFileOpenInSolidWorks(filePath!)) return null;

            // Distinguishes "SolidWorks listed this document" from "we assumed it because COM
            // is down". Only meaningful directly after the call above.
            if (SolidWorksAPI.IsComKnownUnavailable())
            {
                Console.Error.WriteLine($"[Service] SolidWorks COM unreachable, using Document Manager instead: {Path.GetFileName(filePath)}");
                return null;
            }

            Console.Error.WriteLine($"[Service] File is open in SolidWorks, using SW API: {Path.GetFileName(filePath)}");
            try
            {
                return read(filePath!);
            }
            catch (SolidWorksComInaccessibleException ex)
            {
                // COM dropped between the probe and the read.
                Console.Error.WriteLine($"[Service] SolidWorks COM became unreachable, falling back to Document Manager: {ex.Message}");
                return null;
            }
        }

        static CommandResult GetPropertiesFast(string? filePath, JObject command)
        {
            // ONLY use SW API if THIS SPECIFIC FILE is already open in SolidWorks
            // This prevents loading component files into SW when reading assembly properties
            // (Opening an assembly via OpenDoc6 loads ALL component references, which stay orphaned
            // in SW session even after closing the main assembly)
            var swResult = TryReadWhileOpenInSolidWorks(
                filePath,
                path => _swApi!.GetCustomProperties(path, command["configuration"]?.ToString()));
            if (swResult != null) return swResult;
            
            // Use Document Manager API - fast and doesn't load files into SolidWorks
            // DM API can read properties without launching SW or loading any component files
            // Note: We only check for null here. The DM methods internally call Initialize()
            // which handles reinitialization after ReleaseHandles() was called.
            
            if (_dmApi == null)
            {
                Console.Error.WriteLine($"[Service] Document Manager API not created for: {Path.GetFileName(filePath)}");
                return new CommandResult 
                { 
                    Success = false, 
                    Error = "Document Manager not available. Configure DM license in Settings -> Integrations -> SOLIDWORKS, or use 'Refresh Metadata' for manual extraction." 
                };
            }
            
            Console.Error.WriteLine($"[Service] Using Document Manager API for: {Path.GetFileName(filePath)}");
            var result = _dmApi.GetCustomProperties(filePath, command["configuration"]?.ToString());
            
            if (result.Success)
            {
                // Log property count for debugging
                try
                {
                    dynamic data = result.Data!;
                    var fileProps = data.fileProperties as Dictionary<string, string>;
                    Console.Error.WriteLine($"[Service] DM returned {fileProps?.Count ?? 0} file properties");
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[Service] Error checking DM result: {ex.Message}");
                }
            }
            else
            {
                Console.Error.WriteLine($"[Service] DM failed: {result.Error}");
            }
            
            // Always return DM result - no fallback to slow SW API!
            return result;
        }

        static CommandResult GetConfigurationsFast(string? filePath)
        {
            // If SolidWorks has this file open, use full SW API to avoid DM API conflict
            // (DM API accessing a file open in SW can cause SW to close the file)
            var swResult = TryReadWhileOpenInSolidWorks(filePath, path => _swApi!.GetConfigurations(path));
            if (swResult != null) return swResult;
            
            // Use Document Manager API ONLY - NEVER fall back to full SW API
            // Launching SolidWorks just for configuration extraction is too slow/disruptive
            // Note: We only check for null here. The DM methods internally call Initialize()
            // which handles reinitialization after ReleaseHandles() was called.
            if (_dmApi == null)
            {
                Console.Error.WriteLine($"[Service] Document Manager API not created for: {Path.GetFileName(filePath)}");
                return new CommandResult 
                { 
                    Success = false, 
                    Error = "Document Manager not available. Configure DM license in Settings -> Integrations -> SOLIDWORKS." 
                };
            }
            
            var result = _dmApi.GetConfigurations(filePath);
            if (!result.Success)
            {
                Console.Error.WriteLine($"[Service] DM API failed for getConfigurations: {result.Error}");
            }
            return result;  // Return DM result - no fallback to SW API!
        }

        /// <summary>
        /// Who asked for a reference read. Opening a document window in the user's SolidWorks is a
        /// privileged act; only a request the user initiated may do it.
        /// </summary>
        enum ReferenceOrigin
        {
            /// <summary>The watcher, a sync, a poll. Must never make a window appear.</summary>
            Background,

            /// <summary>A click. May escalate all the way to opening the document.</summary>
            Foreground,
        }

        /// <summary>
        /// Read the request's origin, defaulting to background so a caller that has not been migrated
        /// cannot open a window by omission.
        /// </summary>
        static ReferenceOrigin ReadReferenceOrigin(JObject command) =>
            string.Equals(command["origin"]?.ToString(), "foreground", StringComparison.OrdinalIgnoreCase)
                ? ReferenceOrigin.Foreground
                : ReferenceOrigin.Background;

        /// <summary>
        /// Resolve a document's references through the cheapest tier that can answer.
        ///
        /// Tier 1 - Document Manager. Headless, needs no SolidWorks process, shows nothing.
        /// Tier 2 - ISldWorks.GetDocumentDependencies2 against an already-running SolidWorks. Reads an
        ///          unopened file, so still no window. Skipped when SolidWorks is not running.
        /// Tier 3 - OpenDoc6, which puts a window on the user's screen. Foreground requests only, or a
        ///          document SolidWorks already has open, where the existing handle is reused.
        ///
        /// A background request that exhausts tier 2 returns REFERENCES_UNRESOLVED. That is a distinct
        /// state from "this file has no references", and the app records and surfaces it rather than
        /// writing an empty reference list it cannot distinguish from a real one.
        ///
        /// The origin decides which reader is handed to tier 0 as well as whether tier 3 is reached.
        /// It has to: tier 0 reuses the handle SolidWorks already holds, but the reader it used to be
        /// given was the same one tier 3 uses, and that one opens the document - and launches
        /// SolidWorks to do it - whenever the handle turns out not to exist. All that stood between a
        /// background request and a window was an IsFileOpenInSolidWorks check microseconds earlier,
        /// which is a race, not a gate. Narrowing that race is what was done before; this closes it,
        /// because the reader a background request is given has no code path that can open anything.
        /// </summary>
        static CommandResult GetReferencesFast(string? filePath, ReferenceOrigin origin)
        {
            // A document SolidWorks already has open cannot be read by Document Manager, and reusing
            // the handle the user already has costs nothing and shows nothing.
            var openHandleResult = origin == ReferenceOrigin.Foreground
                ? TryReadWhileOpenInSolidWorks(filePath, path => _swApi!.GetExternalReferences(path))
                : TryReadWhileOpenInSolidWorks(filePath, path => _swApi!.GetExternalReferencesFromOpenDocument(path));
            if (openHandleResult != null) return openHandleResult;

            if (_dmApi == null)
            {
                Console.Error.WriteLine($"[Service] Document Manager API not created for: {Path.GetFileName(filePath)}");
                return new CommandResult
                {
                    Success = false,
                    Error = "Document Manager not available. Configure DM license in Settings -> Integrations -> SOLIDWORKS."
                };
            }

            var documentManagerResult = _dmApi.GetExternalReferences(filePath);
            if (documentManagerResult.Success) return documentManagerResult;

            var unresolved = documentManagerResult.ErrorCode == DocumentManagerAPI.ReferencesUnresolvedCode;
            Console.Error.WriteLine(
                $"[References] Tier 1 (Document Manager) declined for {Path.GetFileName(filePath)}: {documentManagerResult.Error}");

            // A Document Manager failure that is not "could not resolve" - a missing licence, an
            // unreadable file - is the caller's answer. Escalating would hide it behind a window.
            if (!unresolved) return documentManagerResult;

            if (_swApi == null)
            {
                Console.Error.WriteLine("[References] Tier 2 unavailable: SolidWorks is not installed");
                return documentManagerResult;
            }

            var dependenciesResult = _swApi.GetDependenciesWithoutOpening(filePath);
            if (dependenciesResult != null)
            {
                Console.Error.WriteLine($"[References] Tier 2 (GetDocumentDependencies2) answered for {Path.GetFileName(filePath)}");
                return dependenciesResult;
            }

            if (origin != ReferenceOrigin.Foreground)
            {
                Console.Error.WriteLine(
                    $"[References] Background request exhausted the headless tiers for {Path.GetFileName(filePath)}; not opening SolidWorks");
                return documentManagerResult;
            }

            var swStatus = _swApi.GetSolidWorksRunStatus();
            if (swStatus == "not_running")
            {
                return new CommandResult
                {
                    Success = false,
                    Error = "SOLIDWORKS_NOT_RUNNING",
                    ErrorCode = "SOLIDWORKS_NOT_RUNNING",
                    Data = new { message = "SolidWorks must be running to read this drawing's references" }
                };
            }

            if (swStatus == "process_only")
            {
                return new CommandResult
                {
                    Success = false,
                    Error = "SOLIDWORKS_COM_INACCESSIBLE",
                    ErrorCode = "SOLIDWORKS_COM_INACCESSIBLE",
                    Data = new { message = "SolidWorks is running but not accessible via COM. Try running both applications with the same permissions." }
                };
            }

            Console.Error.WriteLine($"[References] Tier 3 (OpenDoc6) for foreground request: {Path.GetFileName(filePath)}");
            var openedResult = _swApi.GetExternalReferences(filePath);
            return openedResult.Success ? openedResult : documentManagerResult;
        }

        /// <summary>
        /// Duplicate a model and its drawing so the copied drawing references the copied model.
        /// Tries Document Manager first because it needs no SolidWorks launch, then falls back to
        /// Pack and Go for files Document Manager cannot open (typically a file saved by a newer
        /// SolidWorks than the installed Document Manager library).
        /// </summary>
        static CommandResult DuplicateWithReferences(
            string? sourceModelPath,
            string? targetModelPath,
            string? sourceDrawingPath,
            string? targetDrawingPath)
        {
            if (string.IsNullOrEmpty(sourceModelPath) || string.IsNullOrEmpty(targetModelPath))
                return new CommandResult { Success = false, Error = "Missing 'sourceModelPath' or 'targetModelPath'" };

            var hasDrawing = !string.IsNullOrEmpty(sourceDrawingPath) && !string.IsNullOrEmpty(targetDrawingPath);

            // A file open in SolidWorks cannot be read by Document Manager, and duplicating it
            // would capture the last saved state rather than what the user sees on screen.
            if (_swApi != null)
            {
                foreach (var path in new[] { sourceModelPath, hasDrawing ? sourceDrawingPath : null })
                {
                    if (string.IsNullOrEmpty(path) || !_swApi.IsFileOpenInSolidWorks(path!)) continue;
                    return new CommandResult
                    {
                        Success = false,
                        Error = $"{Path.GetFileName(path)} is open in SolidWorks. Close it and try again.",
                        ErrorCode = "FILE_OPEN_IN_SOLIDWORKS"
                    };
                }
            }

            CommandResult? dmResult = null;
            if (_dmApi != null)
            {
                dmResult = _dmApi.DuplicateWithReferences(sourceModelPath, targetModelPath, sourceDrawingPath, targetDrawingPath);
                if (dmResult.Success) return dmResult;
                Console.Error.WriteLine($"[Service] DM duplicate failed ({dmResult.ErrorCode}): {dmResult.Error}");
            }

            // Without a drawing there is nothing to remap, so Pack and Go adds no value
            if (!hasDrawing)
            {
                return dmResult ?? new CommandResult
                {
                    Success = false,
                    Error = "Document Manager not available. Configure DM license in Settings -> Integrations -> SOLIDWORKS."
                };
            }

            if (_swApi == null || !_swApi.IsSolidWorksAvailable())
            {
                return dmResult ?? new CommandResult
                {
                    Success = false,
                    Error = "Duplicating with reference remapping requires either a Document Manager license or a SolidWorks installation.",
                    ErrorCode = "NO_ENGINE_AVAILABLE"
                };
            }

            Console.Error.WriteLine("[Service] Falling back to Pack and Go for duplicate");
            var nameMap = new Dictionary<string, string>
            {
                [sourceModelPath] = targetModelPath,
                [sourceDrawingPath!] = targetDrawingPath!,
            };

            var pagResult = _swApi.DuplicateViaPackAndGo(sourceDrawingPath, nameMap);
            if (pagResult.Success || dmResult == null) return pagResult;

            // Surface both failures; either one alone is misleading about what went wrong
            return new CommandResult
            {
                Success = false,
                Error = $"{dmResult.Error} Pack and Go fallback also failed: {pagResult.Error}",
                ErrorCode = pagResult.ErrorCode ?? dmResult.ErrorCode,
                ErrorDetails = pagResult.ErrorDetails
            };
        }

        // Track if Document Manager previews work (they don't for newer SW file formats)
        static bool _dmPreviewWorks = true;
        
        static CommandResult GetPreviewFast(string? filePath, string? configuration)
        {
            // Strategy:
            // 1. Try Document Manager API (fastest, no SW launch)
            // 2. If DM fails, try Windows Shell thumbnail (uses SW's shell extension)
            // 3. NEVER fall back to full SolidWorks API (too slow/disruptive)
            
            if (string.IsNullOrEmpty(filePath))
                return new CommandResult { Success = false, Error = "File path is required" };
            
            // Try Document Manager first (if it's working)
            // Note: We only check for null here. The DM methods internally call Initialize()
            // which handles reinitialization after ReleaseHandles() was called.
            if (_dmPreviewWorks && _dmApi != null)
            {
                var result = _dmApi.GetPreviewImage(filePath, configuration);
                if (result.Success)
                {
                    return result;
                }
                
                // If DM fails with certain errors, disable it for future calls
                if (result.Error?.Contains("E_UNEXPECTED") == true || 
                    result.Error?.Contains("Method not found") == true ||
                    result.Error?.Contains("Catastrophic") == true)
                {
                    Console.Error.WriteLine("[Service] Document Manager preview doesn't work for this file format.");
                    Console.Error.WriteLine("[Service] Falling back to Windows Shell thumbnails.");
                    _dmPreviewWorks = false;
                }
            }
            
            // Windows Shell thumbnail fallback
            // Note: Shell thumbnail extraction may hold file handles temporarily, which can
            // occasionally interfere with folder moves. However, this is better than no previews.
            Console.Error.WriteLine("[Service] DM API preview failed, trying Shell fallback...");
            return WindowsShellThumbnail.GetThumbnail(filePath!, 256);
        }

        /// <summary>
        /// The service is running without a SolidWorks installation to fall back to, so a Document
        /// Manager failure is the end of the line rather than the start of an escalation.
        /// </summary>
        static CommandResult DocumentManagerOnlyMode(string operationName) => new CommandResult
        {
            Success = false,
            Error = "This operation requires SolidWorks to be installed",
            ErrorCode = "SW_NOT_INSTALLED",
            ErrorDetails = $"The '{operationName}' operation fell back to SolidWorks because Document Manager " +
                           "could not complete it, but no SolidWorks installation is available."
        };

        static CommandResult SetPropertiesFast(string? filePath, System.Collections.Generic.Dictionary<string, string>? properties, string? configuration)
        {
            // Writes to a file that is NOT currently open in SolidWorks go through the Document
            // Manager API, which writes properties without launching SolidWorks. This removes the
            // SolidWorks cold start from the critical path for the common metadata edit.
            //
            // Configuration-level writes used to be excluded here, on the belief that the DM API's
            // AddCustomProperty silently failed for them on newer file formats. Measured on a real
            // part, that limitation does not exist: creates failed at BOTH scopes because the
            // service passed a custom-property type that is not a member of SwDmCustomInfoType.
            // With the correct type, DM creates and updates properties at file and configuration
            // level alike.
            //
            // If the file IS open in SolidWorks the SW path is used instead: there is no cold start
            // to avoid, and pointing DM at an open document can foul it.
            bool fileOpenInSw = _swApi != null && !string.IsNullOrEmpty(filePath) && _swApi.IsFileOpenInSolidWorks(filePath!);
            bool comUnreachable = fileOpenInSw && SolidWorksAPI.IsComKnownUnavailable();

            if ((!fileOpenInSw || comUnreachable) && (_dmApi?.IsAvailable ?? false))
            {
                if (comUnreachable)
                {
                    // "Open in SolidWorks" here is the assumption IsFileOpenInSolidWorks makes when
                    // COM is unreachable. An unreachable SolidWorks cannot be holding the file on
                    // our behalf, and the SW path can only fail, so DM is both safe and the only
                    // path that can answer.
                    Console.Error.WriteLine($"[Service] SolidWorks COM unreachable, writing properties through Document Manager: {(filePath != null ? Path.GetFileName(filePath) : "(null)")}");
                }
                else
                {
                    Console.Error.WriteLine($"[Service] DM-first property write for {(filePath != null ? Path.GetFileName(filePath) : "(null)")} (scope: {configuration ?? "file-level"})");
                }

                var dmResult = _dmApi!.SetCustomProperties(filePath, properties, configuration);
                if (dmResult.Success)
                {
                    return dmResult;
                }

                // DM failed - fall back to the full SolidWorks COM API (may cold-start SW),
                // preserving the previous behavior and error handling.
                if (_swApi == null) return dmResult;
                Console.Error.WriteLine($"[Service] DM property write failed ({dmResult.Error}); falling back to SolidWorks COM API");
            }

            if (_swApi == null)
                return DocumentManagerOnlyMode("setProperties");

            return _swApi.SetCustomProperties(filePath, properties, configuration);
        }

        static CommandResult SetPropertiesBatchFast(string? filePath, System.Collections.Generic.Dictionary<string, System.Collections.Generic.Dictionary<string, string>>? configProperties)
        {
            // This is a batch because Document Manager writes every configuration inside one
            // open/save cycle. The SolidWorks COM path cannot: it is one OpenDoc6/Save3/CloseDoc
            // per configuration, which on a part with 68 configurations is 68 round trips against
            // a 60-second timeout. It is the fallback, not the default.
            if (configProperties == null)
                return new CommandResult { Success = false, Error = "Missing configProperties" };

            bool fileOpenInSw = _swApi != null && !string.IsNullOrEmpty(filePath) && _swApi.IsFileOpenInSolidWorks(filePath!);
            bool comUnreachable = fileOpenInSw && SolidWorksAPI.IsComKnownUnavailable();

            if ((!fileOpenInSw || comUnreachable) && (_dmApi?.IsAvailable ?? false))
            {
                Console.Error.WriteLine($"[Service] DM batch property write for {(filePath != null ? Path.GetFileName(filePath) : "(null)")} ({configProperties.Count} configurations, one open/save cycle)");
                var dmResult = _dmApi!.SetCustomPropertiesBatch(filePath, configProperties);
                if (dmResult.Success)
                {
                    return dmResult;
                }

                if (_swApi == null) return dmResult;
                Console.Error.WriteLine($"[Service] DM batch write failed ({dmResult.Error}); falling back to SolidWorks COM API");
            }

            if (_swApi == null)
                return DocumentManagerOnlyMode("setPropertiesBatch");

            var written = new List<string>();
            var failed = new Dictionary<string, string>();
            foreach (var kvp in configProperties)
            {
                var result = _swApi!.SetCustomProperties(filePath, kvp.Value, kvp.Key);
                if (result.Success)
                    written.Add(kvp.Key);
                else
                    failed[kvp.Key] = result.Error ?? "unknown error";
            }

            if (written.Count == 0 && failed.Count > 0)
            {
                return new CommandResult
                {
                    Success = false,
                    Error = $"Failed to write properties to any of the {failed.Count} configurations: " +
                            string.Join("; ", failed.Select(f => $"{f.Key}: {f.Value}"))
                };
            }

            return new CommandResult
            {
                Success = true,
                Data = new
                {
                    filePath,
                    configurationsProcessed = written.Count,
                    configurationsFailed = failed.Count,
                    failedConfigurations = failed.Count > 0 ? failed : null
                }
            };
        }

        // ========================================
        // Service control
        // ========================================

        static CommandResult Ping()
        {
            Console.Error.WriteLine("[Service] Ping received");
            Console.Error.WriteLine($"[Service] DM API instance: {(_dmApi != null ? "exists" : "null")}");
            Console.Error.WriteLine($"[Service] DM API IsAvailable: {_dmApi?.IsAvailable ?? false}");
            Console.Error.WriteLine($"[Service] DM API InitError: {_dmApi?.InitializationError ?? "(none)"}");
            Console.Error.WriteLine($"[Service] SW API IsSolidWorksAvailable: {_swApi?.IsSolidWorksAvailable() ?? false}");
            
            var dmAvailable = _dmApi?.IsAvailable ?? false;
            var swAvailable = _swApi!.IsSolidWorksAvailable();
            
            // Determine operational mode
            // full: both DM and SW APIs available
            // dm-only: only Document Manager API (no SW installation)
            // limited: neither API available (missing license key)
            var mode = dmAvailable 
                ? (swAvailable ? "full" : "dm-only")
                : "limited";
            
            return new CommandResult 
            { 
                Success = true, 
                Data = new 
                { 
                    message = "pong", 
                    version = SERVICE_VERSION,
                    // Capability flags
                    documentManagerAvailable = dmAvailable,
                    documentManagerError = !dmAvailable ? _dmApi?.InitializationError : null,
                    swInstalled = swAvailable,
                    swApiAvailable = swAvailable,
                    fastModeEnabled = dmAvailable,
                    // Which SolidWorks release this service talks to (see SolidWorksComRegistry)
                    preferredProgId = SolidWorksComRegistry.PreferredProgId,
                    activeProgId = SolidWorksComRegistry.ResolvedProgId ?? SolidWorksComRegistry.PreferredProgId,
                    comInstallCount = SolidWorksComRegistry.GetInstalls().Count,
                    documentManagerDllPath = _dmApi?.LoadedAssemblyPath,
                    // Operational mode
                    mode = mode
                } 
            };
        }

        static CommandResult SetDmLicense(string? licenseKey)
        {
            Console.Error.WriteLine("[Service] SetDmLicense command received");
            Console.Error.WriteLine($"[Service] License key provided: {!string.IsNullOrEmpty(licenseKey)}");
            
            if (licenseKey == null || licenseKey.Length == 0)
                return new CommandResult { Success = false, Error = "Missing 'licenseKey'" };

            Console.Error.WriteLine("[Service] License key provided for update");

            if (_dmApi == null)
            {
                Console.Error.WriteLine("[Service] Creating new DocumentManagerAPI instance");
                _dmApi = new DocumentManagerAPI();
            }

            Console.Error.WriteLine("[Service] Calling SetLicenseKey...");
            var success = _dmApi.SetLicenseKey(licenseKey);
            Console.Error.WriteLine($"[Service] SetLicenseKey result: {(success ? "SUCCESS" : "FAILED")}");
            if (!success)
            {
                Console.Error.WriteLine($"[Service] Error: {_dmApi.InitializationError}");
            }

            return new CommandResult
            {
                Success = success,
                Data = success ? new { message = "Document Manager license key set successfully! Fast mode now enabled." } : null,
                Error = success ? null : _dmApi.InitializationError
            };
        }

        static CommandResult ReleaseHandles()
        {
            Console.Error.WriteLine("[Service] Processing releaseHandles command");
            if (_dmApi != null)
            {
                var released = _dmApi.ReleaseHandles();
                return new CommandResult 
                { 
                    Success = true, 
                    Data = new { released = true, dmAvailable = _dmApi.IsAvailable }
                };
            }
            return new CommandResult { Success = true, Data = new { released = false, reason = "DM not initialized" } };
        }

        static CommandResult ResetComConnection()
        {
            Console.Error.WriteLine("[Service] Processing resetComConnection command");
            _swApi?.ResetComConnection();
            return new CommandResult
            {
                Success = true,
                Data = new
                {
                    reset = true,
                    swProcessRunning = SolidWorksAPI.IsSolidWorksProcessRunning()
                }
            };
        }

        static CommandResult Quit()
        {
            _dmApi?.Dispose();
            _swApi?.Dispose();
            _comStability?.Dispose();
            Environment.Exit(0);
            return new CommandResult { Success = true };
        }

        static void PrintUsage()
        {
            Console.WriteLine($@"
BluePLM SolidWorks Service v{SERVICE_VERSION}
=================================

FAST operations (Document Manager API - NO SolidWorks launch!):
  getBom, getProperties, setProperties, getConfigurations, getReferences, getPreview
  Requires a DM license key (free with SW subscription)

Open Document Management (control documents in running SolidWorks):
  getOpenDocuments, isDocumentOpen, getDocumentInfo, setDocumentReadOnly, saveDocument
  Allows checkout/checkin without closing files!

SLOW operations (Full SolidWorks API - launches SW):
  getMassProperties, exports, createDocumentFromTemplate, replaceComponent, packAndGo

Usage:
  BluePLM.SolidWorksService.exe [options]

Options:
  --dm-license <key>   Document Manager API license key for fast mode

  --sw-progid <id>     Versioned SolidWorks ProgID to prefer when several releases are
                       installed (e.g. SldWorks.Application.32 for 2024). Defaults to
                       whichever release registered SldWorks.Application.
  
  --close-sw-after     Close SolidWorks after each operation
  
  --command <json>     Execute a single command and exit
  
  --help               Show this help message

Document Manager write diagnostic (never launches SolidWorks):
  --dm-probe <file>    Report which interop DLL loads, inventory the file's properties, and
                       exit. Read-only unless --allow-write is also passed: without it,
                       nothing under the fixture root is written, moved or deleted.
  --probe-config <n>   Configuration to target. Defaults to the first one reported.
  --allow-write        Exercise the write path: sweep the fixture folder clean of anything an
                       interrupted run left behind, back up the file, capture every return
                       value from SetCustomProperty / AddCustomProperty / Save, re-read
                       through a fresh Document Manager handle, then restore from the backup.
                       Refuses to run outside the regression fixture root (override it with
                       the BLUEPLM_FIXTURE_ROOT environment variable).
  --probe-readonly     Force the read-only file attribute on before writing, to capture what
                       Save() returns for a file the vault has marked read-only.

Getting a Document Manager License Key (FREE with SW subscription):
  1. Go to https://customerportal.solidworks.com/
  2. Log in with your SolidWorks subscription
  3. Navigate to 'API Support' -> 'Request Document Manager Key'
  4. Copy the key and use with --dm-license or setDmLicense command

Commands:
  {{""action"": ""ping""}}
  {{""action"": ""warmup""}}
  {{""action"": ""setDmLicense"", ""licenseKey"": ""YOUR_KEY_HERE""}}
  
  -- FAST (no SW launch with DM key) --
  {{""action"": ""getBom"", ""filePath"": ""...""}}
  {{""action"": ""getProperties"", ""filePath"": ""..."", ""configuration"": ""Default""}}
  {{""action"": ""setProperties"", ""filePath"": ""..."", ""properties"": {{""PartNumber"": ""BR-12345""}}}}
  {{""action"": ""getConfigurations"", ""filePath"": ""...""}}
  {{""action"": ""getReferences"", ""filePath"": ""...""}}
  {{""action"": ""getPreview"", ""filePath"": ""..."", ""configuration"": ""Default""}}
  
  -- Open Document Management (checkout/checkin without closing SW!) --
  {{""action"": ""getOpenDocuments""}}
  {{""action"": ""isDocumentOpen"", ""filePath"": ""...""}}
  {{""action"": ""getDocumentInfo"", ""filePath"": ""...""}}
  {{""action"": ""setDocumentReadOnly"", ""filePath"": ""..."", ""readOnly"": false}}
  {{""action"": ""saveDocument"", ""filePath"": ""...""}}
  
  -- SLOW (launches SolidWorks) --
  {{""action"": ""getMassProperties"", ""filePath"": ""...""}}
  {{""action"": ""exportPdf"", ""filePath"": ""...""}}
  {{""action"": ""exportStep"", ""filePath"": ""...""}}
  {{""action"": ""createDocumentFromTemplate"", ""templatePath"": ""C:\\templates\\Part.prtdot"", ""outputPath"": ""C:\\output\\NewPart.sldprt""}}
  {{""action"": ""replaceComponent"", ""filePath"": ""..."", ""oldComponent"": ""..."", ""newComponent"": ""...""}}
  {{""action"": ""packAndGo"", ""filePath"": ""..."", ""outputFolder"": ""...""}}
");
        }
    }

    public class CommandResult
    {
        [JsonProperty("success")]
        public bool Success { get; set; }

        [JsonProperty("data", NullValueHandling = NullValueHandling.Ignore)]
        public object? Data { get; set; }

        [JsonProperty("error", NullValueHandling = NullValueHandling.Ignore)]
        public string? Error { get; set; }

        [JsonProperty("errorDetails", NullValueHandling = NullValueHandling.Ignore)]
        public string? ErrorDetails { get; set; }

        [JsonProperty("errorCode", NullValueHandling = NullValueHandling.Ignore)]
        public string? ErrorCode { get; set; }

        [JsonProperty("requestId", NullValueHandling = NullValueHandling.Ignore)]
        public int? RequestId { get; set; }
    }
    
    /// <summary>
    /// PDM metadata passed from the frontend as fallback for file properties
    /// </summary>
    public class PdmMetadata
    {
        [JsonProperty("partNumber")]
        public string? PartNumber { get; set; }
        
        [JsonProperty("tabNumber")]
        public string? TabNumber { get; set; }
        
        [JsonProperty("revision")]
        public string? Revision { get; set; }
        
        [JsonProperty("description")]
        public string? Description { get; set; }
    }

    /// <summary>
    /// The metadata actually substituted into an export filename.
    ///
    /// File properties win over the PDM values the frontend supplies, so the two can differ -
    /// most visibly when a drawing's stored properties have drifted from its parent model.
    /// Reporting the resolved values back lets bluePLM tag the exported file with what was
    /// really used and flag the divergence instead of silently disagreeing with itself.
    /// </summary>
    public class ResolvedExportMetadata
    {
        [JsonProperty("partNumber")]
        public string? PartNumber { get; set; }

        [JsonProperty("tabNumber")]
        public string? TabNumber { get; set; }

        [JsonProperty("revision")]
        public string? Revision { get; set; }

        [JsonProperty("description")]
        public string? Description { get; set; }
    }
}
