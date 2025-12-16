using System;
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
            _dmApi = new DocumentManagerAPI(dmLicenseKey);
            _dmApi.Initialize(); // Try to init, may fail if no license key
            
            // Initialize SolidWorks API handler (for exports - launches SW on demand)
            _swApi = new SolidWorksAPI(keepSwRunning);

            // Single command mode
            if (singleCommand && !string.IsNullOrEmpty(commandJson))
            {
                var result = ProcessCommand(commandJson);
                Console.WriteLine(JsonConvert.SerializeObject(result));
                return result.Success ? 0 : 1;
            }

            // Interactive mode - read commands from stdin
            var dmStatus = _dmApi.IsAvailable ? "✓ READY (fast mode enabled)" : $"✗ {_dmApi.InitializationError}";
            Console.Error.WriteLine("BluePLM SolidWorks Service v1.0.0");
            Console.Error.WriteLine($"  Document Manager API: {dmStatus}");
            Console.Error.WriteLine("  Full SolidWorks API: launches on demand for exports");
            Console.Error.WriteLine("Ready for commands...");
            
            string? line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                
                try
                {
                    var result = ProcessCommand(line);
                    Console.WriteLine(JsonConvert.SerializeObject(result));
                }
                catch (Exception ex)
                {
                    var error = new CommandResult
                    {
                        Success = false,
                        Error = $"Unhandled error: {ex.Message}",
                        ErrorDetails = ex.ToString()
                    };
                    Console.WriteLine(JsonConvert.SerializeObject(error));
                }
                
                Console.Out.Flush();
            }

            _dmApi?.Dispose();
            _swApi?.Dispose();

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
                    "getMassProperties" => _swApi!.GetMassProperties(filePath,
                        command["configuration"]?.ToString()),
                    
                    // Exports (need full SW)
                    "exportPdf" => _swApi!.ExportToPdf(filePath, 
                        command["outputPath"]?.ToString()),
                    "exportStep" => _swApi!.ExportToStep(filePath,
                        command["outputPath"]?.ToString(),
                        command["configuration"]?.ToString(),
                        command["exportAllConfigs"]?.Value<bool>() ?? false),
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
                var result = _dmApi.GetCustomProperties(filePath, command["configuration"]?.ToString());
                if (result.Success) return result;
            }
            
            // Fall back to full SW API (will launch SW - slower)
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

        static CommandResult GetPreviewFast(string? filePath, string? configuration)
        {
            // Document Manager can extract high-res previews without launching SW!
            if (_dmApi != null && _dmApi.IsAvailable)
            {
                return _dmApi.GetPreviewImage(filePath, configuration);
            }
            
            // Without DM API, we can't get previews without launching SW
            return new CommandResult 
            { 
                Success = false, 
                Error = "Document Manager API not available. Configure DM license key to enable high-res previews without launching SolidWorks." 
            };
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

        // ========================================
        // Service control
        // ========================================

        static CommandResult Ping()
        {
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
            if (string.IsNullOrEmpty(licenseKey))
                return new CommandResult { Success = false, Error = "Missing 'licenseKey'" };

            if (_dmApi == null)
                _dmApi = new DocumentManagerAPI();

            var success = _dmApi.SetLicenseKey(licenseKey);

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
