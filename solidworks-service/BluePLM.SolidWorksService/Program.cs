using System;
using System.Collections.Generic;
using System.IO;
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
        private static DocumentManagerAPI? _dmApi;
        private static SolidWorksAPI? _swApi;

        static int Main(string[] args)
        {
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
                    case "--help":
                        PrintUsage();
                        return 0;
                }
            }

            // Initialize Document Manager API (for FAST operations - no SW launch!)
            Console.Error.WriteLine("=== BluePLM SolidWorks Service Startup ===");
            Console.Error.WriteLine($"[Startup] DM License key from command line: {(dmLicenseKey == null ? "not provided" : $"provided ({dmLicenseKey.Length} chars)")}");
            if (dmLicenseKey != null && dmLicenseKey.Length > 0)
            {
                Console.Error.WriteLine($"[Startup] License key prefix: {(dmLicenseKey.Length > 30 ? dmLicenseKey.Substring(0, 30) + "..." : dmLicenseKey)}");
            }
            
            Console.Error.WriteLine("[Startup] Creating DocumentManagerAPI instance...");
            _dmApi = new DocumentManagerAPI(dmLicenseKey);
            
            Console.Error.WriteLine("[Startup] Calling Initialize()...");
            var initResult = _dmApi.Initialize(); // Try to init, may fail if no license key
            Console.Error.WriteLine($"[Startup] Initialize() returned: {initResult}");
            Console.Error.WriteLine($"[Startup] IsAvailable: {_dmApi.IsAvailable}");
            Console.Error.WriteLine($"[Startup] InitializationError: {_dmApi.InitializationError ?? "(none)"}");
            
            // Initialize SolidWorks API handler (for exports - launches SW on demand)
            Console.Error.WriteLine("[Startup] Creating SolidWorksAPI instance...");
            _swApi = new SolidWorksAPI(keepSwRunning);
            Console.Error.WriteLine($"[Startup] SolidWorks available: {_swApi.IsSolidWorksAvailable()}");

            // Single command mode
            if (singleCommand && commandJson != null && commandJson.Length > 0)
            {
                var result = ProcessCommand(commandJson);
                Console.WriteLine(JsonConvert.SerializeObject(result));
                return result.Success ? 0 : 1;
            }

            // Interactive mode - read commands from stdin
            var dmStatus = _dmApi.IsAvailable ? "✓ READY (fast mode enabled)" : $"✗ {_dmApi.InitializationError}";
            Console.Error.WriteLine("=== Service Ready ===");
            Console.Error.WriteLine("BluePLM SolidWorks Service v1.0.0");
            Console.Error.WriteLine($"  Document Manager API: {dmStatus}");
            Console.Error.WriteLine("  Full SolidWorks API: launches on demand for exports");
            Console.Error.WriteLine("Ready for commands...");
            
            string? line;
            try
            {
                while ((line = Console.ReadLine()) != null)
                {
                    Console.Error.WriteLine($"[Service] Received command: {line.Substring(0, Math.Min(50, line.Length))}...");
                    
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    
                    try
                    {
                        var result = ProcessCommand(line);
                        var response = JsonConvert.SerializeObject(result);
                        Console.Error.WriteLine($"[Service] Sending response ({response.Length} chars)");
                        Console.WriteLine(response);
                        Console.Out.Flush();
                        Console.Error.WriteLine("[Service] Response sent, waiting for next command...");
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[Service] Exception processing command: {ex.Message}");
                        var error = new CommandResult
                        {
                            Success = false,
                            Error = $"Unhandled error: {ex.Message}",
                            ErrorDetails = ex.ToString()
                        };
                        Console.WriteLine(JsonConvert.SerializeObject(error));
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
            Console.Error.WriteLine("[Service] Cleanup complete, exiting with code 0");

            return 0;
        }

        static CommandResult ProcessCommand(string json)
        {
            try
            {
                var command = JsonConvert.DeserializeObject<JObject>(json);
                if (command == null)
                    return new CommandResult { Success = false, Error = "Invalid JSON" };

                var action = command["action"]?.ToString();
                var filePath = command["filePath"]?.ToString();

                if (string.IsNullOrEmpty(action))
                    return new CommandResult { Success = false, Error = "Missing 'action' field" };

                return action switch
                {
                    // ========================================
                    // FAST operations (Document Manager API)
                    // NO SolidWorks launch - instant!
                    // ========================================
                    
                    "getBom" => GetBomFast(filePath, command),
                    "getProperties" => GetPropertiesFast(filePath, command),
                    "getConfigurations" => GetConfigurationsFast(filePath),
                    "getReferences" => GetReferencesFast(filePath),
                    "getPreview" => GetPreviewFast(filePath, command["configuration"]?.ToString()),
                    
                    // ========================================
                    // Open Document Management
                    // Control documents open in running SolidWorks
                    // ========================================
                    
                    "getOpenDocuments" => _swApi!.GetOpenDocuments(),
                    "isDocumentOpen" => _swApi!.IsDocumentOpen(filePath),
                    "getDocumentInfo" => _swApi!.GetDocumentInfo(filePath),
                    "setDocumentReadOnly" => _swApi!.SetDocumentReadOnly(filePath,
                        command["readOnly"]?.Value<bool>() ?? true),
                    "saveDocument" => _swApi!.SaveDocument(filePath),
                    
                    // ========================================
                    // SLOW operations (Full SolidWorks API)
                    // Launches SolidWorks when needed
                    // ========================================
                    
                    "setProperties" => SetPropertiesFast(filePath, 
                        command["properties"]?.ToObject<System.Collections.Generic.Dictionary<string, string>>(),
                        command["configuration"]?.ToString()),
                    "setPropertiesBatch" => SetPropertiesBatchFast(filePath,
                        command["configProperties"]?.ToObject<System.Collections.Generic.Dictionary<string, System.Collections.Generic.Dictionary<string, string>>>()),
                    "getMassProperties" => _swApi!.GetMassProperties(filePath,
                        command["configuration"]?.ToString()),
                    
                    // Exports (need full SW)
                    "exportPdf" => _swApi!.ExportToPdf(filePath, 
                        command["outputPath"]?.ToString()),
                    "exportStep" => _swApi!.ExportToStep(filePath,
                        command["outputPath"]?.ToString(),
                        command["configuration"]?.ToString(),
                        command["exportAllConfigs"]?.Value<bool>() ?? false,
                        command["configurations"]?.ToObject<string[]>(),
                        command["filenamePattern"]?.ToString()),
                    "exportIges" => _swApi!.ExportToIges(filePath,
                        command["outputPath"]?.ToString()),
                    "exportDxf" => _swApi!.ExportToDxf(filePath,
                        command["outputPath"]?.ToString()),
                    "exportImage" => _swApi!.ExportToImage(filePath,
                        command["outputPath"]?.ToString(),
                        command["width"]?.Value<int>() ?? 800,
                        command["height"]?.Value<int>() ?? 600),
                    
                    // Assembly operations (need full SW)
                    "replaceComponent" => _swApi!.ReplaceComponent(filePath,
                        command["oldComponent"]?.ToString(),
                        command["newComponent"]?.ToString()),
                    "packAndGo" => _swApi!.PackAndGo(filePath,
                        command["outputFolder"]?.ToString(),
                        command["prefix"]?.ToString(),
                        command["suffix"]?.ToString()),
                    
                    // Service control
                    "ping" => Ping(),
                    "setDmLicense" => SetDmLicense(command["licenseKey"]?.ToString()),
                    "quit" => Quit(),
                    
                    _ => new CommandResult { Success = false, Error = $"Unknown action: {action}" }
                };
            }
            catch (JsonException ex)
            {
                return new CommandResult { Success = false, Error = $"JSON parse error: {ex.Message}" };
            }
        }

        // ========================================
        // FAST operations - use DM API, fall back to SW API
        // ========================================

        static CommandResult GetBomFast(string? filePath, JObject command)
        {
            // Try Document Manager first (NO SW launch!)
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                var result = _dmApi.GetBillOfMaterials(filePath, command["configuration"]?.ToString());
                if (result.Success) return result;
            }
            
            // Fall back to full SW API (will launch SW - slower)
            return _swApi!.GetBillOfMaterials(filePath, 
                command["includeChildren"]?.Value<bool>() ?? true,
                command["configuration"]?.ToString());
        }

        static CommandResult GetPropertiesFast(string? filePath, JObject command)
        {
            // Try Document Manager first (NO SW launch!)
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                Console.Error.WriteLine($"[Service] Trying Document Manager API for: {Path.GetFileName(filePath)}");
                var result = _dmApi.GetCustomProperties(filePath, command["configuration"]?.ToString());
                
                if (result.Success)
                {
                    // Check if we got actual properties
                    bool hasProps = false;
                    try
                    {
                        dynamic data = result.Data!;
                        var fileProps = data.fileProperties as Dictionary<string, string>;
                        hasProps = fileProps != null && fileProps.Count > 0;
                        Console.Error.WriteLine($"[Service] DM returned {fileProps?.Count ?? 0} file properties");
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[Service] Error checking DM result: {ex.Message}");
                    }
                    
                    if (hasProps)
                    {
                        return result;
                    }
                    
                    // For drawings with empty properties, try full SW API as fallback
                    var ext = Path.GetExtension(filePath ?? "").ToLowerInvariant();
                    if (ext == ".slddrw")
                    {
                        Console.Error.WriteLine($"[Service] DM returned empty for drawing, trying full SW API...");
                    }
                    else
                    {
                        // For parts/assemblies, empty properties may be valid
                        return result;
                    }
                }
                else
                {
                    Console.Error.WriteLine($"[Service] DM failed: {result.Error}");
                }
            }
            
            // Fall back to full SW API (will launch SW - slower)
            Console.Error.WriteLine($"[Service] Falling back to full SolidWorks API");
            return _swApi!.GetCustomProperties(filePath, command["configuration"]?.ToString());
        }

        static CommandResult GetConfigurationsFast(string? filePath)
        {
            // Try Document Manager first (NO SW launch!)
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                var result = _dmApi.GetConfigurations(filePath);
                if (result.Success) return result;
            }
            
            // Fall back to full SW API (will launch SW - slower)
            return _swApi!.GetConfigurations(filePath);
        }

        static CommandResult GetReferencesFast(string? filePath)
        {
            // Try Document Manager first (NO SW launch!)
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                var result = _dmApi.GetExternalReferences(filePath);
                if (result.Success) return result;
            }
            
            // Fall back to full SW API (will launch SW - slower)
            return _swApi!.GetExternalReferences(filePath);
        }

        // Track if Document Manager previews work (they don't for newer SW file formats)
        static bool _dmPreviewWorks = true;
        
        static CommandResult GetPreviewFast(string? filePath, string? configuration)
        {
            // ONLY use Document Manager API - NEVER fall back to full SolidWorks!
            // Opening SolidWorks just for previews is extremely annoying to users.
            // If Document Manager fails, the Electron app will use the embedded OLE preview instead.
            
            if (!_dmPreviewWorks)
            {
                return new CommandResult 
                { 
                    Success = false, 
                    Error = "Document Manager preview not available for this file format. Use embedded preview." 
                };
            }
            
            if (_dmApi == null || !_dmApi.IsAvailable)
            {
                return new CommandResult 
                { 
                    Success = false, 
                    Error = "Document Manager not available. Use embedded preview." 
                };
            }
            
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
                Console.Error.WriteLine("[Service] Future preview requests will fall back to embedded OLE preview.");
                _dmPreviewWorks = false;
            }
            
            // Return the DM error - do NOT fall back to opening SolidWorks!
            return result;
        }

        static CommandResult SetPropertiesFast(string? filePath, System.Collections.Generic.Dictionary<string, string>? properties, string? configuration)
        {
            // Try Document Manager first (NO SW launch!)
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                var result = _dmApi.SetCustomProperties(filePath, properties, configuration);
                if (result.Success) return result;
            }
            
            // Fall back to full SW API (will launch SW - slower)
            return _swApi!.SetCustomProperties(filePath, properties, configuration);
        }

        static CommandResult SetPropertiesBatchFast(string? filePath, System.Collections.Generic.Dictionary<string, System.Collections.Generic.Dictionary<string, string>>? configProperties)
        {
            // Try Document Manager first (NO SW launch!)
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                var result = _dmApi.SetCustomPropertiesBatch(filePath, configProperties);
                if (result.Success) return result;
            }
            
            // Fall back to doing it one at a time with SW API (slower)
            if (configProperties == null)
                return new CommandResult { Success = false, Error = "Missing configProperties" };
                
            int success = 0;
            foreach (var kvp in configProperties)
            {
                var result = _swApi!.SetCustomProperties(filePath, kvp.Value, kvp.Key);
                if (result.Success) success++;
            }
            
            return new CommandResult 
            { 
                Success = success > 0,
                Data = new { configurationsProcessed = success }
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
            
            return new CommandResult 
            { 
                Success = true, 
                Data = new 
                { 
                    message = "pong", 
                    version = "1.0.0",
                    documentManagerAvailable = _dmApi?.IsAvailable ?? false,
                    documentManagerError = _dmApi?.IsAvailable == false ? _dmApi?.InitializationError : null,
                    swInstalled = _swApi!.IsSolidWorksAvailable(),
                    fastModeEnabled = _dmApi?.IsAvailable ?? false
                } 
            };
        }

        static CommandResult SetDmLicense(string? licenseKey)
        {
            Console.Error.WriteLine("[Service] SetDmLicense command received");
            Console.Error.WriteLine($"[Service] License key provided: {!string.IsNullOrEmpty(licenseKey)}");
            
            if (licenseKey == null || licenseKey.Length == 0)
                return new CommandResult { Success = false, Error = "Missing 'licenseKey'" };

            Console.Error.WriteLine($"[Service] License key length: {licenseKey.Length}");
            Console.Error.WriteLine($"[Service] License key prefix: {(licenseKey.Length > 30 ? licenseKey.Substring(0, 30) + "..." : licenseKey)}");

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

        static CommandResult Quit()
        {
            _dmApi?.Dispose();
            _swApi?.Dispose();
            Environment.Exit(0);
            return new CommandResult { Success = true };
        }

        static void PrintUsage()
        {
            Console.WriteLine(@"
BluePLM SolidWorks Service v1.0.0
=================================

FAST operations (Document Manager API - NO SolidWorks launch!):
  getBom, getProperties, setProperties, getConfigurations, getReferences, getPreview
  Requires a DM license key (free with SW subscription)

Open Document Management (control documents in running SolidWorks):
  getOpenDocuments, isDocumentOpen, getDocumentInfo, setDocumentReadOnly, saveDocument
  Allows checkout/checkin without closing files!

SLOW operations (Full SolidWorks API - launches SW):
  getMassProperties, exports, replaceComponent, packAndGo

Usage:
  BluePLM.SolidWorksService.exe [options]

Options:
  --dm-license <key>   Document Manager API license key for fast mode
                       Can also use SOLIDWORKS_DM_LICENSE_KEY env var
  
  --close-sw-after     Close SolidWorks after each operation
  
  --command <json>     Execute a single command and exit
  
  --help               Show this help message

Getting a Document Manager License Key (FREE with SW subscription):
  1. Go to https://customerportal.solidworks.com/
  2. Log in with your SolidWorks subscription
  3. Navigate to 'API Support' → 'Request Document Manager Key'
  4. Copy the key and use with --dm-license or setDmLicense command

Commands:
  {""action"": ""ping""}
  {""action"": ""setDmLicense"", ""licenseKey"": ""YOUR_KEY_HERE""}
  
  -- FAST (no SW launch with DM key) --
  {""action"": ""getBom"", ""filePath"": ""...""}
  {""action"": ""getProperties"", ""filePath"": ""..."", ""configuration"": ""Default""}
  {""action"": ""setProperties"", ""filePath"": ""..."", ""properties"": {""PartNumber"": ""BR-12345""}}
  {""action"": ""getConfigurations"", ""filePath"": ""...""}
  {""action"": ""getReferences"", ""filePath"": ""...""}
  {""action"": ""getPreview"", ""filePath"": ""..."", ""configuration"": ""Default""}
  
  -- Open Document Management (checkout/checkin without closing SW!) --
  {""action"": ""getOpenDocuments""}
  {""action"": ""isDocumentOpen"", ""filePath"": ""...""}
  {""action"": ""getDocumentInfo"", ""filePath"": ""...""}
  {""action"": ""setDocumentReadOnly"", ""filePath"": ""..."", ""readOnly"": false}
  {""action"": ""saveDocument"", ""filePath"": ""...""}
  
  -- SLOW (launches SolidWorks) --
  {""action"": ""getMassProperties"", ""filePath"": ""...""}
  {""action"": ""exportPdf"", ""filePath"": ""...""}
  {""action"": ""exportStep"", ""filePath"": ""...""}
  {""action"": ""replaceComponent"", ""filePath"": ""..."", ""oldComponent"": ""..."", ""newComponent"": ""...""}
  {""action"": ""packAndGo"", ""filePath"": ""..."", ""outputFolder"": ""...""}
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
    }
}
