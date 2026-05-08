import Capacitor
import Foundation

/// Capacitor 6 only auto-discovers plugins shipped via CocoaPods. App-level
/// Swift plugins (like ours) need to be registered explicitly with the
/// bridge once it loads. Subclassing CAPBridgeViewController and overriding
/// `capacitorDidLoad` is the official hook.
///
/// The storyboard's root view controller class is updated to point at this
/// subclass (see Base.lproj/Main.storyboard).
public class MainViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(IcloudSyncPlugin())
    }
}


/// Minimal file-IO bridge for the app's iCloud container. Exposes the few
/// operations the JS sync engine needs:
///
///   - containerPath      → absolute path of the sync directory (creates it)
///   - readFile(filename) → text content or null
///   - appendFile(name)   → append text to a file (creates if missing)
///   - listFiles          → names of files in the sync directory
///
/// The container id is `iCloud.<bundle-id>` by convention. We resolve it via
/// FileManager's ubiquity APIs; if the user has iCloud disabled or the app
/// lacks the iCloud capability, every call rejects with an explanatory
/// message so the JS side can show it on the Sync settings page.
@objc(IcloudSyncPlugin)
public class IcloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IcloudSyncPlugin"
    public let jsName = "IcloudSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "containerPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
    ]

    private let containerId = "iCloud.com.benmccloskey.JapaneseReadingCompanion"

    private func syncDir() -> URL? {
        guard let containerURL = FileManager.default.url(
            forUbiquityContainerIdentifier: containerId
        ) else {
            return nil
        }
        return containerURL
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("sync", isDirectory: true)
    }

    private func ensureSyncDir() -> URL? {
        guard let url = syncDir() else { return nil }
        try? FileManager.default.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: nil
        )
        return url
    }

    @objc func containerPath(_ call: CAPPluginCall) {
        guard let url = ensureSyncDir() else {
            call.reject(
                "iCloud is not available — make sure you're signed into iCloud, "
              + "the app has the iCloud capability enabled, and iCloud Drive is on."
            )
            return
        }
        call.resolve(["path": url.path])
    }

    @objc func ensureFolder(_ call: CAPPluginCall) {
        guard ensureSyncDir() != nil else {
            call.reject("iCloud not available")
            return
        }
        call.resolve()
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename") else {
            call.reject("filename required")
            return
        }
        guard let dir = syncDir() else {
            call.reject("iCloud not available")
            return
        }
        let fileURL = dir.appendingPathComponent(filename)

        // If iCloud sees this file but hasn't downloaded it yet, kick off a
        // download. The actual read may then fail; subsequent polls will
        // succeed once iCloud finishes.
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: fileURL)
        }

        do {
            let content = try String(contentsOf: fileURL, encoding: .utf8)
            call.resolve(["content": content])
        } catch {
            let nsErr = error as NSError
            // Treat "no such file" as null so the JS engine can skip cleanly.
            if nsErr.code == NSFileReadNoSuchFileError ||
               nsErr.code == NSFileNoSuchFileError {
                call.resolve(["content": NSNull()])
                return
            }
            call.reject(error.localizedDescription)
        }
    }

    @objc func appendFile(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"),
              let content = call.getString("content") else {
            call.reject("filename and content required")
            return
        }
        guard let dir = ensureSyncDir() else {
            call.reject("iCloud not available")
            return
        }
        let fileURL = dir.appendingPathComponent(filename)
        guard let data = content.data(using: .utf8) else {
            call.reject("Could not encode content as UTF-8")
            return
        }
        do {
            if !FileManager.default.fileExists(atPath: fileURL.path) {
                try data.write(to: fileURL, options: .atomic)
            } else {
                let handle = try FileHandle(forWritingTo: fileURL)
                handle.seekToEndOfFile()
                handle.write(data)
                try handle.close()
            }
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func listFiles(_ call: CAPPluginCall) {
        guard let dir = syncDir() else {
            call.resolve(["files": [String]()])
            return
        }
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        call.resolve(["files": files])
    }
}
