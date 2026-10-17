package core

import std.env.getVariable
import std.sync.*
import std.unittest.*
import std.fs.*
import stdx.encoding.json.*
import std.collection.*

func withCapsuleApi(action: (ExecutionApi, ExecutionService, ApprovalDesk, String, String) -> Unit, colocated!: Bool = false): Unit {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", "ORIGINAL".toArray()) },
        { _, root, _, _, _ =>
            let log = SessionLog(if (colocated) { root + "\\session.log" } else { getVariable("TEMP").getOrThrow() + "\\capsule-api-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}.log" })
            let lease = WriteLease(log.path); @Expect(lease.acquire(), true)
            let service = ExecutionService(log, lease, "current")
            try {
                SessionWorkspace(log).setDirectory(root)
                let desk = ApprovalDesk(log)
                let api = ExecutionApi(service, desk, "current", reviewStore: Some(AttachmentStore(if (colocated) { root + "\\attachments\\v1" } else { log.path + ".objects" }, log, AttachmentLimits.localBackend())),
                    workspaceRoot: getVariable("SACODE_WINDOWS_SCOPE_PARENT").getOrThrow())
                let proposal = JsonObject(); proposal.put("cwd", JsonString(root)); proposal.put("workspaceRevision", JsonInt(1))
                proposal.put("executable", JsonString(getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe"))
                proposal.put("timeoutMs", JsonInt(5000)); proposal.put("outputLimit", JsonInt(64))
                let argv = JsonArray(); for (arg in ["/d", "/s", "/c", "echo DEFAULT>input.txt"]) { argv.add(JsonString(arg)) }; proposal.put("argv", argv)
                action(api, service, desk, root, proposal.toString())
            } finally { @Expect(service.shutdownWorkspaces(), true); lease.release() }
        })
}
func capsuleProposal(proposal: String, request: String): String {
    let input = JsonObject(); input.put("sessionId", JsonString("current")); input.put("taskId", JsonString("capsule"))
    input.put("requestId", JsonString(request)); input.put("proposal", JsonString(proposal)); return input.toString()
}

@Test
func executionApiPreparesApprovesRunsAndReleasesRealWorkspaceCapsule() {
    withCapsuleApi({ api, service, desk, root, proposal =>
        let prepared = JsonValue.fromStr(api.dispatch("execution/propose", capsuleProposal(proposal, "run"))).asObject()
        @Expect(prepared.get("providerAvailable").getOrThrow().asBool().getValue(), true)
        let snapshot = JsonValue.fromStr(prepared.get("workspaceSnapshot").getOrThrow().asString().getValue()).asObject()
        let directory = snapshot.get("executionDirectory").getOrThrow().asString().getValue(); @Expect(exists(directory), true)
        let id = prepared.get("executionId").getOrThrow().asString().getValue()
        let ticket = desk.askForCall("execution/start",prepared.get("approvalArguments").getOrThrow().asString().getValue())
        @Expect(desk.answer(ticket,"allowed-once"),true)
        let approve = JsonObject(); approve.put("sessionId",JsonString("current")); approve.put("executionId",JsonString(id))
        approve.put("revision",prepared.get("revision").getOrThrow()); approve.put("proposalDigest",prepared.get("proposalDigest").getOrThrow()); approve.put("approvalId",JsonInt(ticket))
        let admitted = JsonValue.fromStr(api.dispatch("execution/authorize",approve.toString())).asObject()
        let start = JsonObject(); start.put("sessionId",JsonString("current")); start.put("executionId",JsonString(id)); start.put("revision",admitted.get("revision").getOrThrow())
        let finished = JsonValue.fromStr(api.dispatch("execution/start",start.toString())).asObject()
        @Expect(finished.get("phase").getOrThrow().asString().getValue(),"exited")
        @Expect(finished.get("review").getOrThrow().asString().getValue().size>0,true)
        @Expect(exists(directory),false); @Expect(String.fromUtf8(File.readFrom(root+"\\input.txt")),"ORIGINAL")
        @Expect(SessionWorkspace(service.log).directory().toAsciiLower(),root.toAsciiLower())
    })
}

@Test
func executionApiColocatedDataPreservesUserFilesAndCompletes() {
    withCapsuleApi({ api, service, desk, root, proposal =>
        Directory.create(root + "\\user")
        File.writeTo(root + "\\user\\session.log", "USER_LOG".toArray())
        let prepared = JsonValue.fromStr(api.dispatch("execution/propose", capsuleProposal(proposal, "run"))).asObject()
        @Expect(prepared.get("providerAvailable").getOrThrow().asBool().getValue(), true)
        let snapshot = JsonValue.fromStr(prepared.get("workspaceSnapshot").getOrThrow().asString().getValue()).asObject()
        let directory = snapshot.get("executionDirectory").getOrThrow().asString().getValue(); @Expect(exists(directory), true)
        @Expect(exists(directory + "\\session.log"), false)
        @Expect(exists(directory + "\\session.log.lease"), false)
        @Expect(String.fromUtf8(File.readFrom(directory + "\\user\\session.log")), "USER_LOG")
        let id = prepared.get("executionId").getOrThrow().asString().getValue()
        let ticket = desk.askForCall("execution/start",prepared.get("approvalArguments").getOrThrow().asString().getValue())
        @Expect(desk.answer(ticket,"allowed-once"),true)
        let approve = JsonObject(); approve.put("sessionId",JsonString("current")); approve.put("executionId",JsonString(id))
        approve.put("revision",prepared.get("revision").getOrThrow()); approve.put("proposalDigest",prepared.get("proposalDigest").getOrThrow()); approve.put("approvalId",JsonInt(ticket))
        let admitted = JsonValue.fromStr(api.dispatch("execution/authorize",approve.toString())).asObject()
        let start = JsonObject(); start.put("sessionId",JsonString("current")); start.put("executionId",JsonString(id)); start.put("revision",admitted.get("revision").getOrThrow())
        let finished = JsonValue.fromStr(api.dispatch("execution/start",start.toString())).asObject()
        @Expect(finished.get("phase").getOrThrow().asString().getValue(),"exited")
        @Expect(finished.get("review").getOrThrow().asString().getValue().size>0,true)
        @Expect(exists(directory),false); @Expect(String.fromUtf8(File.readFrom(root+"\\input.txt")),"ORIGINAL")
        @Expect(SessionWorkspace(service.log).directory().toAsciiLower(),root.toAsciiLower())
    }, colocated: true)
}


@Test
func snapshotManagedPathsRemainProtectedWithoutIgnoringUserNamedLogs() {
    withWorkspaceSnapshot({ root =>
        File.writeTo(root + "\\session.log", "PRIVATE_LOG".toArray())
        Directory.create(root + "\\user")
        File.writeTo(root + "\\user\\session.log", "USER_LOG".toArray())
    }, { original, root, _, _, _ =>
        let snapshot = WindowsWorkspaceSnapshot(original.source, original.destination, "current", "private-task", "private-request", 1,
            ownedPaths: [root + "\\session.log", root + "\\private\\objects"])
        snapshot.capture()
        @Expect(exists(original.destination.path + "\\session.log"), false)
        @Expect(String.fromUtf8(original.destination.bytes("user/session.log", false)), "USER_LOG")
        File.writeTo(root + "\\session.log", "LOG_CHANGED".toArray())
        Directory.create(root + "\\private\\objects", recursive: true)
        File.writeTo(root + "\\private\\objects\\new.bin", "PRIVATE_OBJECT".toArray())
        snapshot.assertFresh("current", "private-task", "private-request", 1)
        original.destination.writeNew("SESSION.LOG", "FORGED_METADATA".toArray())
        @ExpectThrows[Exception](snapshot.walk(original.destination, "", 0, false, ArrayList<String>(), ArrayList<WorkspaceSnapshotFile>(), true))
        File.writeTo(root + "\\user\\session.log", "USER_CHANGED".toArray())
        @ExpectThrows[Exception](snapshot.assertFresh("current", "private-task", "private-request", 1))
    })
}

@Test
func executionToolPinsBytesAndRejectsReplacementOrAmbiguousRelativePath() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\program.exe", "ORIGINAL_TOOL".toArray()) },
        { _, root, _, _, _ =>
            let tool = WindowsExecutionTool(root + "\\program.exe")
            @Expect(tool.digest, sha256Hex("ORIGINAL_TOOL".toArray()))
            tool.assertFresh()
            File.writeTo(root + "\\program.exe", "CHANGED_TOOL".toArray())
            @ExpectThrows[Exception](tool.assertFresh())
            @ExpectThrows[Exception](WindowsExecutionTool(".\\program.exe"))
            @ExpectThrows[Exception](WindowsExecutionTool("sacode-missing-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}"))
        })
}

@Test
func executionCapsuleApprovalContainsResolvedProgramAndFingerprint() {
    withCapsuleApi({ api, service, _, _, proposal =>
        let prepared = JsonValue.fromStr(api.dispatch("execution/propose",capsuleProposal(proposal,"tool-binding"))).asObject()
        let receipt = JsonValue.fromStr(prepared.get("workspaceSnapshot").getOrThrow().asString().getValue()).asObject()
        let binding = receipt.get("toolBinding").getOrThrow().asString().getValue()
        let tool = JsonValue.fromStr(binding).asObject()
        @Expect(tool.get("requested").getOrThrow().asString().getValue(),JsonValue.fromStr(proposal).asObject().get("executable").getOrThrow().asString().getValue())
        @Expect(tool.get("sha256").getOrThrow().asString().getValue().size,Int64(64))
        @Expect(service.approvalArguments(prepared.get("executionId").getOrThrow().asString().getValue()).contains("toolBinding"),true)
    })
}

@Test
func executionApiUnstartedCapsuleShutdownAndReplayNeverExecute() {
    withCapsuleApi({ api, service, _, root, proposal =>
        let prepared = JsonValue.fromStr(api.dispatch("execution/propose",capsuleProposal(proposal,"never-start"))).asObject()
        let id = prepared.get("executionId").getOrThrow().asString().getValue()
        let directory = JsonValue.fromStr(prepared.get("workspaceSnapshot").getOrThrow().asString().getValue()).asObject().get("executionDirectory").getOrThrow().asString().getValue()
        let restored = ExecutionService(service.log,service.lease,"current")
        let other = ExecutionApi(restored,ApprovalDesk(service.log),"current",reviewStore:Some(AttachmentStore(service.log.path+".objects",service.log,AttachmentLimits.localBackend())))
        let start = JsonObject(); start.put("sessionId",JsonString("current")); start.put("executionId",JsonString(id)); start.put("revision",JsonInt(1))
        @ExpectThrows[Exception](other.dispatch("execution/start",start.toString()))
        @Expect(service.shutdownWorkspaces(),true); @Expect(exists(directory),false)
        @Expect(service.describe(id).phase,"cancelled-before-start")
        @Expect(String.fromUtf8(File.readFrom(root+"\\input.txt")),"ORIGINAL")
    })
}

@Test
func executionApiRejectsOverlappingCapsuleRootWithoutChangingSource() {
    withCapsuleApi({ _, service, desk, root, proposal =>
        let invalidApi = ExecutionApi(service,desk,"current",reviewStore:Some(AttachmentStore(service.log.path+".objects",service.log,AttachmentLimits.localBackend())),workspaceRoot:root)
        @ExpectThrows[Exception ](invalidApi.dispatch("execution/propose",capsuleProposal(proposal,"overlap")))
        @Expect(String.fromUtf8(File.readFrom(root+"\\input.txt")),"ORIGINAL")
        @Expect(service.shutdownWorkspaces(),true)
    })
}

@Test
func privateWorkspaceDisposalRemovesOnlyOwnedNestedContents() {
    withPrivateWorkspace(true, { scope, library, _ =>
        let tree = WindowsWorkspaceTree(library, scope.path, true)
        try {
            tree.mkdir("src"); tree.mkdir("src/deep")
            tree.writeNew("src/deep/模块.txt", "PRIVATE".toArray())
            tree.writeNew("empty.txt", [])
        } finally { tree.close() }
        scope.disposeContents()
        @Expect(exists(scope.path), true)
        @Expect(exists(scope.path + "\\src"), false)
        scope.disposeContents() // 空目录幂等；根只由scope.close最终撤销。
    })
}

@Test
func privateWorkspaceDisposalRejectsBusyFileThenCanRetry() {
    withPrivateWorkspace(true, { scope, library, _ =>
        let tree = WindowsWorkspaceTree(library, scope.path, true)
        tree.writeNew("input.txt", "BUSY".toArray()); tree.close()
        let system = acSystemModule("kernel32.dll")
        let create = CFunc<(CPointer<UInt16>, UInt32, UInt32, CPointer<Unit>, UInt32, UInt32, CPointer<Unit>) -> CPointer<Unit>>(acExport(system, "CreateFileW"))
        let close = CFunc<(CPointer<Unit>) -> Int32>(acExport(system, "CloseHandle"))
        let free = CFunc<(CPointer<Unit>) -> Int32>(acExport(system, "FreeLibrary"))
        let path = unsafe { acquireArrayRawData(fileWidePath(scope.path + "\\input.txt")) }
        let held = try { unsafe { create(path.pointer, 2147483648, 1, CPointer<Unit>(), 3, 128, CPointer<Unit>()) } }
            finally { unsafe { releaseArrayRawData(path) } }
        @Expect(fileHandleValid(held), true)
        try { @ExpectThrows[Exception](scope.disposeContents()); @Expect(String.fromUtf8(File.readFrom(scope.path + "\\input.txt")), "BUSY") }
        finally { unsafe { close(held); free(system) } }
        scope.disposeContents(); @Expect(exists(scope.path + "\\input.txt"), false)
    })
}

func disposalFixture(action: String, scope: String): Unit {
    let result = runOwnedProcess(getVariable("SACODE_WORKSPACE_FIXTURE_NODE").getOrThrow(),
        [getVariable("SACODE_DISPOSAL_FIXTURE_SCRIPT").getOrThrow(), action, scope], None, 5000, 1024,
        {=> false}, {_ =>}).getOrThrow()
    @Expect(result.exitCode, Int64(0)); @Expect(result.stdout.contains("SACODE_DISPOSAL_FIXTURE confirmed"), true)
}

@Test
func privateWorkspaceDisposalRejectsLinksAndKeepsOutsideCanary() {
    withPrivateWorkspace(true, { scope, _, _ =>
        disposalFixture("junction", scope.path)
        try {
            @ExpectThrows[Exception](scope.disposeContents())
            disposalFixture("remove-junction", scope.path)
            disposalFixture("hardlink", scope.path)
            @ExpectThrows[Exception](scope.disposeContents())
        } finally { disposalFixture("cleanup", scope.path) }
        scope.disposeContents()
    })
}

@Test
func windowsCasReplacementRejectsLaterUserEditAndConcurrentWriter() {
    withPrivateWorkspace(true, { scope, library, _ =>
        let tree = WindowsWorkspaceTree(library, scope.path, true)
        try {
            tree.writeNew("input.txt", "BEFORE".toArray())
            let first = tree.compareExchange("input.txt", Some("BEFORE".toArray()), Some("AFTER".toArray()))
            @Expect(first.error, UInt32(0)); @Expect(first.mayHaveChanged, true)
            let stale = tree.compareExchange("input.txt", Some("BEFORE".toArray()), Some("BAD".toArray()))
            @Expect(stale.error != 0, true); @Expect(stale.mayHaveChanged, false)
            @Expect(String.fromUtf8(tree.bytes("input.txt", false)), "AFTER")
            let system = acSystemModule("kernel32.dll")
            let create = CFunc<(CPointer<UInt16>, UInt32, UInt32, CPointer<Unit>, UInt32, UInt32, CPointer<Unit>) -> CPointer<Unit>>(acExport(system, "CreateFileW"))
            let close = CFunc<(CPointer<Unit>) -> Int32>(acExport(system, "CloseHandle"))
            let free = CFunc<(CPointer<Unit>) -> Int32>(acExport(system, "FreeLibrary"))
            let name = unsafe { acquireArrayRawData(fileWidePath(scope.path + "\\input.txt")) }
            let held = try { unsafe { create(name.pointer, 1073741824, 0, CPointer<Unit>(), 3, 128, CPointer<Unit>()) } }
                finally { unsafe { releaseArrayRawData(name) } }
            @Expect(fileHandleValid(held), true)
            try {
                let blocked = tree.compareExchange("input.txt", Some("AFTER".toArray()), Some("BAD".toArray()))
                @Expect(blocked.error != 0, true); @Expect(blocked.mayHaveChanged, false)
            } finally { unsafe { close(held); free(system) } }
            @Expect(String.fromUtf8(tree.bytes("input.txt", false)), "AFTER")
            @Expect(tree.compareExchange("input.txt", Some("AFTER".toArray()), Some(Array<Byte>(0, repeat: 0))).error, UInt32(0))
            @Expect(tree.bytes("input.txt", false).size, Int64(0))
        } finally { tree.close() }
    })
}

@Test
func windowsCasCreateAndDeleteDistinguishAbsentFromEmpty() {
    withPrivateWorkspace(true, { scope, library, _ =>
        let tree = WindowsWorkspaceTree(library, scope.path, true)
        try {
            @Expect(tree.compareExchange("input.txt", None, Some(Array<Byte>(0, repeat: 0))).error, UInt32(0))
            let conflict = tree.compareExchange("input.txt", None, Some("BAD".toArray()))
            @Expect(conflict.error != 0, true); @Expect(conflict.mayHaveChanged, false)
            @Expect(tree.bytes("input.txt", false).size, Int64(0))
            @Expect(tree.compareExchange("input.txt", Some(Array<Byte>(0, repeat: 0)), None).error, UInt32(0))
            @Expect(exists(scope.path + "\\input.txt"), false)
            let absent = tree.compareExchange("input.txt", Some(Array<Byte>(0, repeat: 0)), None)
            @Expect(absent.error != 0, true); @Expect(absent.mayHaveChanged, false)
        } finally { tree.close() }
    })
}

@Test
func windowsCasReadOnlyAndTraversalNeverChangeSource() {
    withPrivateWorkspace(true, { scope, library, _ =>
        File.writeTo(scope.path + "\\input.txt", "BEFORE".toArray())
        let tree = WindowsWorkspaceTree(library, scope.path, false)
        try {
            let denied = tree.compareExchange("input.txt", Some("BEFORE".toArray()), Some("BAD".toArray()))
            @Expect(denied.error != 0, true); @Expect(denied.mayHaveChanged, false)
            @ExpectThrows[Exception](tree.compareExchange("input.txt", None, None))
        } finally { tree.close() }
        let writable = WindowsWorkspaceTree(library, scope.path, true)
        try {
            for (path in ["../input.txt", "input.txt:stream", "NUL"]) {
                let denied = writable.compareExchange(path, None, Some("BAD".toArray()))
                @Expect(denied.error != 0, true); @Expect(denied.mayHaveChanged, false)
            }
            @Expect(String.fromUtf8(writable.bytes("input.txt", false)), "BEFORE")
        } finally { writable.close() }
    })
}

@Test
func windowsCasHardlinkAndJunctionTargetsAreRejected() {
    withWorkspaceSnapshot({ root =>
        File.writeTo(root + "\\input.txt", "BEFORE".toArray())
        snapshotLinkFixture("hardlink", root)
        snapshotLinkFixture("junction", root)
    }, { _, root, _, library, _ =>
        let tree = WindowsWorkspaceTree(library, root, true)
        try {
            for (path in ["input.txt", "link/input.txt"]) {
                let denied = tree.compareExchange(path, Some("BEFORE".toArray()), Some("BAD".toArray()))
                @Expect(denied.error != 0, true); @Expect(denied.mayHaveChanged, false)
            }
            @Expect(String.fromUtf8(File.readFrom(root + "\\input.txt")), "BEFORE")
        } finally { tree.close(); snapshotLinkFixture("remove-junction", root) }
    })
}

@Test
func reviewDirectoryIdentityIsStableAndRejectsReplacementAtSamePath() {
    withPrivateWorkspace(true, { scope, library, _ =>
        Directory.create(scope.path + "\\src")
        let first = WindowsWorkspaceTree(library, scope.path + "\\src", true)
        first.writeNew("input.txt", "SAME_BYTES".toArray())
        let old = first.identity
        @Expect(old.size, Int64(48))
        @Expect(platformReviewDirectoryIdentity(first.path), old)
        first.close()
        rename(scope.path + "\\src", to: scope.path + "\\empty", overwrite: false)
        Directory.create(scope.path + "\\src")
        let second = WindowsWorkspaceTree(library, scope.path + "\\src", true)
        try {
            second.writeNew("input.txt", "SAME_BYTES".toArray())
            @Expect(second.identity != old, true)
            let denied = platformReviewExchange(second.path, old, "input.txt", Some("SAME_BYTES".toArray()), Some("BAD".toArray()))
            @Expect(denied.error != 0, true); @Expect(denied.mayHaveChanged, false)
            @Expect(String.fromUtf8(second.bytes("input.txt", false)), "SAME_BYTES")
        } finally { second.close() }
    })
}

@Test
func reviewNativeLibraryUsesActualModuleDirectoryAndUnicodeConversion() {
    let path = reviewNativeLibraryPath()
    @Expect(Path(path).isAbsolute(), true)
    @Expect(Path(path).fileName, "sacode-windows-process.dll")
    let text = "D:/中文/😀/file.exe"
    let encoded = fileWidePath(text)
    @Expect(reviewUtf16String(encoded, encoded.size - 1), text)
    @ExpectThrows[Exception](reviewUtf16String([UInt16(55296)], 1))
}

func withReviewApplyFixture(action: (ExecutionService, AttachmentStore, ApprovalDesk, ExecutionSnapshot, WindowsWorkspaceTree, String) -> Unit): Unit {
    withWorkspaceSnapshot({ root =>
        Directory.create(root + "\\src")
        File.writeTo(root + "\\src\\main.txt", "ORIGINAL".toArray())
        File.writeTo(root + "\\empty.txt", [])
    }, { snapshot, root, scope, library, profile =>
        snapshot.capture()
        let script = "$ErrorActionPreference='Stop';[IO.File]::WriteAllText('src\\main.txt',('C'*70000));" +
            "[IO.File]::WriteAllText('added.txt','ADDED');[IO.File]::Delete('empty.txt');"
        privateWorkspaceTask(scope, library, profile, script, snapshot: Some(snapshot),
            program: getVariable("SystemRoot").getOrThrow() + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            arguments: Some(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", shellEncodedCommand(script)]),
            afterReview: { service, store, desk, terminal =>
                let tree = WindowsWorkspaceTree(library, root, true)
                try { action(service, store, desk, terminal, tree, root) } finally { tree.close() }
            })
    })
}

func reviewApplyId(plan: String): String {
    return JsonValue.fromStr(plan).asObject().get("applyId").getOrThrow().asString().getValue()
}

@Test
func reviewApplyUsesExactApprovalDurableIntentAndDoesNotRepeat() {
    withReviewApplyFixture({ service, store, desk, terminal, tree, root =>
        let calls = AtomicInt64(0)
        let apply = ExecutionReviewApply(service, store, desk, writer: { directory, identity, path, before, after =>
            @Expect(directory.toAsciiLower(), tree.path.toAsciiLower())
            @Expect(identity, tree.identity)
            let disk = SessionLog(service.log.path); @Expect(disk.load(), true)
            var found = false
            for (event in disk.snapshotEvents()) {
                if (event.eventType == "execution/review-apply-intent" && JsonValue.fromStr(event.data).asObject().get("path").getOrThrow().asString().getValue() == path) { found = true }
            }
            @Expect(found, true)
            calls.fetchAdd(1)
            let result = tree.compareExchange(path, before, after)
            return ReviewWriteResult(result.error, result.mayHaveChanged)
        })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-success", ["src/main.txt", "added.txt", "empty.txt"])
        @Expect(apply.propose(terminal.id, terminal.revision, "apply-success", ["src/main.txt", "added.txt", "empty.txt"]), plan)
        @ExpectThrows[Exception](apply.propose(terminal.id, terminal.revision, "apply-success", ["src/main.txt"]))
        let id = reviewApplyId(plan)
        let wrong = desk.askForCall("execution/start", plan); @Expect(desk.answer(wrong, "allowed-once"), true)
        @ExpectThrows[Exception](apply.apply(id, wrong)); @Expect(calls.load(), Int64(0))
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        let result = apply.apply(id, ticket)
        @Expect(JsonValue.fromStr(result).asObject().get("phase").getOrThrow().asString().getValue(), "completed")
        @Expect(calls.load(), Int64(3)); @Expect(apply.apply(id, ticket), result); @Expect(calls.load(), Int64(3))
        @Expect(File.readFrom(root + "\\src\\main.txt").size, Int64(70000))
        @Expect(String.fromUtf8(File.readFrom(root + "\\added.txt")), "ADDED")
        @Expect(exists(root + "\\empty.txt"), false)
    })
}

@Test
func snapshotProviderKeepsLogicalWorkspaceAndRunsOnlyInsidePrivateCopy() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", "ORIGINAL".toArray()) },
        { snapshot, root, scope, library, profile =>
            snapshot.capture()
            let log = SessionLog(getVariable("TEMP").getOrThrow() + "\\logical-task-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}.log")
            let lease = WriteLease(log.path); @Expect(lease.acquire(), true)
            try {
                SessionWorkspace(log).setDirectory(root)
                let service = ExecutionService(log, lease, "current")
                let executable = getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe"
                let proposal = JsonObject(); proposal.put("cwd", JsonString(root)); proposal.put("workspaceRevision", JsonInt(1))
                proposal.put("executable", JsonString(executable)); proposal.put("timeoutMs", JsonInt(5000)); proposal.put("outputLimit", JsonInt(64))
                let argv = JsonArray(); for (arg in ["/d", "/s", "/c", "echo MAPPED>input.txt"]) { argv.add(JsonString(arg)) }; proposal.put("argv", argv)
                let state = service.propose("private-task", "private-request", proposal.toString())
                snapshot.record(log, lease, state)
                let receipt = JsonValue.fromStr(service.workspaceSnapshot(state.id)).asObject()
                @Expect(receipt.get("sourceDirectory").getOrThrow().asString().getValue(), root)
                @Expect(receipt.get("executionDirectory").getOrThrow().asString().getValue(), scope.path)
                let provider = WindowsSnapshotExecutionProvider(service, state.id, snapshot, library, profile,
                    acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()))
                try {
                    let invalid = ExecutionProcessRequest(executable, ["/d", "/s", "/c", "echo MAPPED>input.txt"], scope.path,
                        5000, 64, TurnToken(), {_ =>}, {_ =>})
                    @ExpectThrows[Exception](provider.execute(invalid))
                    let unapproved = ExecutionProcessRequest(executable, ["/d", "/s", "/c", "echo MAPPED>input.txt"], root,
                        5000, 64, TurnToken(), {_ =>}, {_ =>})
                    @ExpectThrows[Exception](provider.execute(unapproved))
                    @Expect(service.describe(state.id).phase, "awaiting-approval")
                    let desk = ApprovalDesk(log); let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
                    @Expect(desk.answer(ticket, "allowed-once"), true)
                    let admitted = service.authorize(state.id, state.revision, ticket, desk)
                    let store = AttachmentStore(log.path + ".objects", log, AttachmentLimits.localBackend())
                    let wrong = WindowsPrivateWorkspace(library, profile, getVariable("SACODE_WINDOWS_SCOPE_PARENT").getOrThrow(),
                        "sacode-workspace-wrong-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}", true)
                    try { wrong.requireReady(); @ExpectThrows[Exception](WindowsSnapshotSettlement(service, store, snapshot, provider, wrong, profile, library)) }
                    finally { wrong.close() }
                    let settlement = WindowsSnapshotSettlement(service, store, snapshot, provider, scope, profile, library)
                    let result = ExecutionSupervisor(service, providerReady: {=> true}, processProvider: Some(provider),
                        onSettled: { state => settlement.complete(state) }).run(admitted.id, admitted.revision)
                    @Expect(scope.closed, true); @Expect(profile.closed, true); @Expect(library.closed, true)
                    @Expect(exists(scope.path), false)
                    @Expect(result.exitCode, Int64(0)); @Expect(result.exitObserved, true); @Expect(result.outputComplete, true)
                    @Expect(SessionWorkspace(log).directory().toAsciiLower(), root.toAsciiLower())
                    @Expect(SessionWorkspace(log).revision(), Int64(1))
                    @Expect(String.fromUtf8(File.readFrom(root + "\\input.txt")), "ORIGINAL")
                    let terminal = service.describe(state.id)
                    let review = service.review(state.id)
                    let files = JsonValue.fromStr(review).asObject().get("files").getOrThrow().asArray()
                    @Expect(files.size(), Int64(1))
                    let object = files.get(0).getOrThrow().asObject().get("afterObject").getOrThrow().asString().getValue()
                    @Expect(String.fromUtf8(store.read(object)).contains("MAPPED"), true)
                    let before = log.eventCount(); settlement.complete(terminal); @Expect(log.eventCount(), before)
                    var released = false
                    for (event in log.snapshotEvents()) { if (event.eventType == "execution/resources-released") { released = true } }
                    @Expect(released, true)
                } finally { provider.close() }
            } finally { lease.release() }
        })
}

@Test
func snapshotSettlementCanRetryAfterDirectoryClosedButLibraryStillReferenced() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", "ORIGINAL".toArray()) },
        { snapshot, root, scope, library, profile =>
            snapshot.capture()
            let log = SessionLog(getVariable("TEMP").getOrThrow() + "\\settlement-retry-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}.log")
            let lease = WriteLease(log.path); @Expect(lease.acquire(), true)
            try {
                SessionWorkspace(log).setDirectory(root)
                let service = ExecutionService(log, lease, "current")
                let proposal = JsonObject(); proposal.put("cwd", JsonString(root)); proposal.put("workspaceRevision", JsonInt(1))
                proposal.put("executable", JsonString(getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe"))
                proposal.put("timeoutMs", JsonInt(5000)); proposal.put("outputLimit", JsonInt(64))
                let argv = JsonArray(); for (arg in ["/d", "/s", "/c", "echo RETRY>input.txt"]) { argv.add(JsonString(arg)) }; proposal.put("argv", argv)
                let state = service.propose("private-task", "private-request", proposal.toString()); snapshot.record(log, lease, state)
                let desk = ApprovalDesk(log); let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
                @Expect(desk.answer(ticket, "allowed-once"), true)
                let admitted = service.authorize(state.id, state.revision, ticket, desk)
                let provider = WindowsSnapshotExecutionProvider(service, state.id, snapshot, library, profile,
                    acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()))
                let extra = WindowsWorkspaceTree(library, root, false)
                let settlement = WindowsSnapshotSettlement(service, AttachmentStore(log.path + ".objects", log, AttachmentLimits.localBackend()), snapshot, provider, scope, profile, library)
                try {
                    let supervisor = ExecutionSupervisor(service, providerReady: {=> true}, processProvider: Some(provider),
                        onSettled: { terminal => settlement.complete(terminal) })
                    @ExpectThrows[Exception](supervisor.run(admitted.id, admitted.revision))
                    @Expect(scope.closed, true); @Expect(profile.closed, true); @Expect(library.closed, false)
                    @Expect(exists(scope.path), false)
                    @Expect(service.describe(state.id).phase, "exited"); @Expect(service.review(state.id).size > 0, true)
                    extra.close()
                    settlement.complete(service.describe(state.id))
                    @Expect(library.closed, true); @Expect(settlement.released, true)
                    @Expect(String.fromUtf8(File.readFrom(root + "\\input.txt")), "ORIGINAL")
                } finally { extra.close(); provider.close() }
            } finally { lease.release() }
        })
}

@Test
func executionPostSettlementFailurePreservesRealExitAndDurableFailure() {
    withPrivateWorkspace(true, { scope, library, profile =>
        let log = SessionLog(getVariable("TEMP").getOrThrow() + "\\settlement-failure-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}.log")
        let lease = WriteLease(log.path); @Expect(lease.acquire(), true)
        try {
            SessionWorkspace(log).setDirectory(scope.path)
            let service = ExecutionService(log, lease, "current")
            let proposal = JsonObject(); proposal.put("cwd", JsonString(scope.path)); proposal.put("workspaceRevision", JsonInt(1))
            proposal.put("executable", JsonString(getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe"))
            proposal.put("timeoutMs", JsonInt(5000)); proposal.put("outputLimit", JsonInt(64))
            let argv = JsonArray(); for (arg in ["/d", "/s", "/c", "echo settled"]) { argv.add(JsonString(arg)) }; proposal.put("argv", argv)
            let state = service.propose("settlement", "settlement", proposal.toString())
            let desk = ApprovalDesk(log); let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
            @Expect(desk.answer(ticket, "allowed-once"), true)
            let admitted = service.authorize(state.id, state.revision, ticket, desk)
            let provider = WindowsExecutionProcessProvider(library, profile,
                acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()), state.proposal)
            try {
                let supervisor = ExecutionSupervisor(service, providerReady: {=> true}, processProvider: Some(provider),
                    onSettled: {_ => throw Exception("injected-post-settlement-failure")})
                @ExpectThrows[Exception](supervisor.run(admitted.id, admitted.revision))
                let terminal = service.describe(state.id); @Expect(terminal.phase, "exited")
                @Expect(JsonValue.fromStr(terminal.result).asObject().get("exitObserved").getOrThrow().asBool().getValue(), true)
                let replay = SessionLog(log.path); @Expect(replay.load(), true)
                var failures: Int64 = 0
                for (event in replay.snapshotEvents()) { if (event.eventType == "execution/settlement-failed") { failures += 1 } }
                @Expect(failures, Int64(1)); @Expect(service.review(state.id), "")
            } finally { provider.cleanup() }
        } finally { lease.release() }
    })
}

@Test
func reviewWriteApiValidatesArgumentsAndSharesAsynchronousApproval() {
    withReviewApplyFixture({ service, store, desk, terminal, tree, _ =>
        let api = ExecutionApi(service, desk, "current", reviewStore: Some(store))
        let input = JsonObject()
        input.put("sessionId", JsonString("current")); input.put("executionId", JsonString(terminal.id))
        input.put("revision", JsonInt(terminal.revision)); input.put("requestId", JsonString("api-write"))
        let paths = JsonArray(); paths.add(JsonString("added.txt")); input.put("paths", paths)
        input.put("sourceDirectory", JsonString("other"))
        @ExpectThrows[Exception](api.dispatch("execution/review-prepare", input.toString()))
        let valid = JsonObject()
        valid.put("sessionId", JsonString("current")); valid.put("executionId", JsonString(terminal.id))
        valid.put("revision", JsonInt(terminal.revision)); valid.put("requestId", JsonString("api-write")); valid.put("paths", paths)
        let prepared = JsonValue.fromStr(api.dispatch("execution/review-prepare", valid.toString())).asObject()
        let id = prepared.get("applyId").getOrThrow().asString().getValue()
        let exact = prepared.get("approvalArguments").getOrThrow().asString().getValue()
        let ticket = desk.askForCall("execution/review-apply", exact); @Expect(desk.answer(ticket, "allowed-once"), true)
        let apply = JsonObject(); apply.put("sessionId", JsonString("current")); apply.put("applyId", JsonString(id)); apply.put("approvalId", JsonInt(ticket))
        let runs = ArrayList<ReviewApplyRun>()
        api.dispatch("execution/review-apply", apply.toString(), asynchronous: true, onReviewStarted: { run => runs.add(run) })
        @Expect(runs.size, Int64(1)); runs[0].wait(timeoutMs: 10000)
        api.dispatch("execution/review-apply", apply.toString(), asynchronous: true, onReviewStarted: { run => runs.add(run) })
        @Expect(runs.size, Int64(1)); @Expect(String.fromUtf8(tree.bytes("added.txt", false)), "ADDED")
        let read = JsonObject(); read.put("sessionId", JsonString("current")); read.put("applyId", JsonString(id))
        @Expect(ExecutionApi.readOnly("execution/review-apply-describe"), true)
        let result = JsonValue.fromStr(api.dispatch("execution/review-apply-describe", read.toString())).asObject()
        @Expect(result.get("phase").getOrThrow().asString().getValue(), "completed")
        @Expect(result.get("approvalArguments").isNone(), true)
        read.put("sessionId", JsonString("other"))
        @ExpectThrows[Exception](api.dispatch("execution/review-apply-stop", read.toString()))
    })
}

@Test
func reviewApplyAsyncStopRemainsResponsiveDuringFileCommit() {
    withReviewApplyFixture({ service, store, desk, terminal, tree, _ =>
        let entered = AtomicBool(false)
        let release = AtomicBool(false)
        let calls = AtomicInt64(0)
        let apply = ExecutionReviewApply(service, store, desk, writer: { _, _, path, before, after =>
            calls.fetchAdd(1)
            entered.store(true)
            for (_ in 0..500) {
                if (release.load()) { break }
                sleep(10 * Duration.millisecond)
            }
            let result = tree.compareExchange(path, before, after)
            return ReviewWriteResult(result.error, result.mayHaveChanged)
        })
        let plan = apply.propose(terminal.id, terminal.revision, "async-stop", ["src/main.txt", "added.txt"])
        let id = reviewApplyId(plan)
        let ticket = desk.askForCall("execution/review-apply", plan)
        @Expect(desk.answer(ticket, "allowed-once"), true)
        let run = apply.start(id, ticket)
        try {
            for (_ in 0..500) {
                if (entered.load()) { break }
                sleep(10 * Duration.millisecond)
            }
            @Expect(entered.load(), true)
            @Expect(run.settled(), false)
            @ExpectThrows[Exception](apply.start(id, ticket))
            let stopping = spawn { => apply.stop(id) }
            let status = stopping.get(500 * Duration.millisecond)
            @Expect(JsonValue.fromStr(status).asObject().get("phase").getOrThrow().asString().getValue(), "applying")
        } finally { release.store(true) }
        let result = run.wait(timeoutMs: 10000)
        @Expect(run.settled(), true)
        @Expect(JsonValue.fromStr(result).asObject().get("phase").getOrThrow().asString().getValue(), "partial-cancelled")
        @Expect(calls.load(), Int64(1))
        @Expect(exists(tree.path + "\\added.txt"), false)
        @Expect(apply.apply(id, ticket), result)
        @Expect(calls.load(), Int64(1))
    })
}

@Test
func reviewApplyConflictKeepsUserEditAndOtherFiles() {
    withReviewApplyFixture({ service, store, desk, terminal, tree, root =>
        let apply = ExecutionReviewApply(service, store, desk, writer: { _, _, path, before, after =>
            let result = tree.compareExchange(path, before, after); return ReviewWriteResult(result.error, result.mayHaveChanged)
        })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-conflict", ["src/main.txt", "added.txt"])
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        File.writeTo(root + "\\src\\main.txt", "USER_EDIT".toArray())
        let result = apply.apply(reviewApplyId(plan), ticket)
        @Expect(JsonValue.fromStr(result).asObject().get("phase").getOrThrow().asString().getValue(), "conflict")
        @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "USER_EDIT")
        @Expect(exists(root + "\\added.txt"), false); @Expect(exists(root + "\\empty.txt"), true)
    })
}

@Test
func reviewApplyUnknownAndInterruptedLogNeverReplay() {
    withReviewApplyFixture({ service, store, desk, terminal, _, root =>
        let calls = AtomicInt64(0)
        let apply = ExecutionReviewApply(service, store, desk, writer: { _, _, _, _, _ =>
            calls.fetchAdd(1); return ReviewWriteResult(UInt32(5), true)
        })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-unknown", ["src/main.txt"])
        let id = reviewApplyId(plan)
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        @Expect(JsonValue.fromStr(apply.apply(id, ticket)).asObject().get("phase").getOrThrow().asString().getValue(), "unknown")
        @Expect(calls.load(), Int64(1)); apply.apply(id, ticket); @Expect(calls.load(), Int64(1))
        // 从真实已落盘日志取最后意图边界的前缀，模拟进程在结果落盘前中断。
        var prefix = ""
        for (line in String.fromUtf8(File.readFrom(service.log.path)).split("\n")) {
            prefix += line + "\n"
            if (line.contains("\texecution/review-apply-intent\t")) { break }
        }
        let path = service.log.path + ".interrupted"
        File.writeTo(path, prefix.toArray())
        let replay = SessionLog(path); @Expect(replay.load(), true)
        let lease = WriteLease(path); @Expect(lease.acquire(), true)
        try {
            let restored = ExecutionReviewApply(ExecutionService(replay, lease, "current"), store, ApprovalDesk(replay), writer: { _, _, _, _, _ =>
                calls.fetchAdd(1); return ReviewWriteResult(UInt32(0), true)
            })
            @Expect(JsonValue.fromStr(restored.describe(id)).asObject().get("phase").getOrThrow().asString().getValue(), "unknown")
            @Expect(JsonValue.fromStr(restored.apply(id, Int64(999))).asObject().get("phase").getOrThrow().asString().getValue(), "unknown")
            @Expect(calls.load(), Int64(1))
        } finally { lease.release() }
        @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "ORIGINAL")
    })
}

@Test
func reviewApplyCancelledBeforeFileCommitDoesNotWrite() {
    withReviewApplyFixture({ service, store, desk, terminal, _, root =>
        let calls = AtomicInt64(0)
        let apply = ExecutionReviewApply(service, store, desk, writer: { _, _, _, _, _ => calls.fetchAdd(1); return ReviewWriteResult(UInt32(0), true) })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-cancel", ["src/main.txt"])
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        let token = TurnToken(); token.cancel()
        @Expect(JsonValue.fromStr(apply.apply(reviewApplyId(plan), ticket, token: token)).asObject().get("phase").getOrThrow().asString().getValue(), "cancelled")
        @Expect(calls.load(), Int64(0)); @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "ORIGINAL")
    })
}

@Test
func reviewApplyPersistenceBarrierFailurePreventsFileWrite() {
    withReviewApplyFixture({ service, store, desk, terminal, _, root =>
        let calls = AtomicInt64(0); let checkpoints = AtomicInt64(0)
        let failed = ExecutionService(service.log, service.lease, "current", checkpoint: { =>
            if (checkpoints.fetchAdd(1) == 2) { false } else { service.log.durableCheckpoint(service.lease) }
        })
        let apply = ExecutionReviewApply(failed, store, desk, writer: { _, _, _, _, _ => calls.fetchAdd(1); return ReviewWriteResult(UInt32(0), true) })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-persistence", ["src/main.txt"])
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        @ExpectThrows[Exception](apply.apply(reviewApplyId(plan), ticket))
        let disk = SessionLog(service.log.path); @Expect(disk.load(), true)
        for (event in disk.snapshotEvents()) { @Expect(event.eventType == "execution/review-apply-intent", false) }
        @Expect(calls.load(), Int64(0)); @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "ORIGINAL")
    })
}

@Test
func reviewApplyPartialConflictReportsEachFileWithoutRollback() {
    withReviewApplyFixture({ service, store, desk, terminal, tree, root =>
        let apply = ExecutionReviewApply(service, store, desk, writer: { _, _, path, before, after =>
            let result = tree.compareExchange(path, before, after); return ReviewWriteResult(result.error, result.mayHaveChanged)
        })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-partial", ["added.txt", "src/main.txt", "empty.txt"])
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        File.writeTo(root + "\\src\\main.txt", "USER_EDIT".toArray())
        let result = JsonValue.fromStr(apply.apply(reviewApplyId(plan), ticket)).asObject()
        @Expect(result.get("phase").getOrThrow().asString().getValue(), "partial-conflict")
        let rows = result.get("files").getOrThrow().asArray()
        @Expect(rows.get(0).getOrThrow().asObject().get("phase").getOrThrow().asString().getValue(), "applied")
        @Expect(rows.get(1).getOrThrow().asObject().get("phase").getOrThrow().asString().getValue(), "conflict")
        @Expect(rows.get(2).getOrThrow().asObject().get("phase").getOrThrow().asString().getValue(), "not-attempted")
        @Expect(String.fromUtf8(File.readFrom(root + "\\added.txt")), "ADDED")
        @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "USER_EDIT")
        @Expect(exists(root + "\\empty.txt"), true)
    })
}

@Test
func reviewApplyWorkspaceSwitchAfterApprovalRejectsBeforeWrite() {
    withReviewApplyFixture({ service, store, desk, terminal, _, root =>
        let calls = AtomicInt64(0)
        let apply = ExecutionReviewApply(service, store, desk, writer: { _, _, _, _, _ => calls.fetchAdd(1); return ReviewWriteResult(UInt32(0), true) })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-workspace", ["src/main.txt"])
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        SessionWorkspace(service.log).setDirectory(root + "\\src")
        @Expect(service.log.durableCheckpoint(service.lease), true)
        @ExpectThrows[Exception](apply.apply(reviewApplyId(plan), ticket))
        @Expect(calls.load(), Int64(0)); @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "ORIGINAL")
    })
}

@Test
func reviewApplyPostWritePersistenceFailureRecoversUnknownWithoutRewritingUserEdit() {
    withReviewApplyFixture({ service, store, desk, terminal, tree, root =>
        let calls = AtomicInt64(0); let checkpoints = AtomicInt64(0)
        let failed = ExecutionService(service.log, service.lease, "current", checkpoint: { =>
            if (checkpoints.fetchAdd(1) == 3) { false } else { service.log.durableCheckpoint(service.lease) }
        })
        let apply = ExecutionReviewApply(failed, store, desk, writer: { _, _, path, before, after =>
            calls.fetchAdd(1); let result = tree.compareExchange(path, before, after)
            return ReviewWriteResult(result.error, result.mayHaveChanged)
        })
        let plan = apply.propose(terminal.id, terminal.revision, "apply-post-write", ["src/main.txt"])
        let ticket = desk.askForCall("execution/review-apply", plan); @Expect(desk.answer(ticket, "allowed-once"), true)
        @ExpectThrows[Exception](apply.apply(reviewApplyId(plan), ticket))
        @Expect(calls.load(), Int64(1)); @Expect(File.readFrom(root + "\\src\\main.txt").size, Int64(70000))
        File.writeTo(root + "\\src\\main.txt", "USER_AFTER_UNKNOWN".toArray())
        let disk = SessionLog(service.log.path); @Expect(disk.load(), true)
        let restored = ExecutionReviewApply(ExecutionService(disk, service.lease, "current"), store, ApprovalDesk(disk), writer: { _, _, _, _, _ => calls.fetchAdd(1); return ReviewWriteResult(UInt32(0), true) })
        let id = reviewApplyId(plan)
        @Expect(JsonValue.fromStr(restored.describe(id)).asObject().get("phase").getOrThrow().asString().getValue(), "unknown")
        @Expect(JsonValue.fromStr(restored.apply(id, Int64(999))).asObject().get("phase").getOrThrow().asString().getValue(), "unknown")
        @Expect(calls.load(), Int64(1)); @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "USER_AFTER_UNKNOWN")
        let review = JsonValue.fromStr(service.review(terminal.id)).asObject()
        let first = review.get("files").getOrThrow().asArray().get(0).getOrThrow().asObject()
        // 写前对象仍可从内容存储核对，恢复不会擅自覆盖用户编辑。
        @Expect(store.read(first.get("beforeObject").getOrThrow().asString().getValue()).size > 0, true)
    })
}

func withWorkspaceSnapshot(setup: (String) -> Unit,
    action: (WindowsWorkspaceSnapshot, String, WindowsPrivateWorkspace, WindowsProcessLibrary, WindowsOwnedProfile) -> Unit): Unit {
    withPrivateWorkspace(true, { scope, library, profile =>
        let root = getVariable("TEMP").getOrThrow() + "\\snapshot-source-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}"
        Directory.create(root)
        setup(root)
        let source = WindowsWorkspaceTree(library, root, false)
        try {
            let destination = WindowsWorkspaceTree(library, scope.requireReady(), true)
            try { action(WindowsWorkspaceSnapshot(source, destination, "current", "private-task", "private-request", 1), root, scope, library, profile) }
            finally { destination.close() }
        } finally { source.close() }
    })
}

func snapshotLinkFixture(action: String, root: String): Unit {
    let result = runOwnedProcess(getVariable("SACODE_WORKSPACE_FIXTURE_NODE").getOrThrow(),
        [getVariable("SACODE_SNAPSHOT_LINK_SCRIPT").getOrThrow(), action, root], None, 5000, 1024,
        { => false }, { _ => }).getOrThrow()
    @Expect(result.exitCode, Int64(0))
    @Expect(result.stdout.contains("SACODE_SNAPSHOT_LINK_FIXTURE confirmed"), true)
}

@Test
func windowsSnapshotCapturesTreeExcludesProtectedAndExportsActualTaskChanges() {
    withWorkspaceSnapshot({ root =>
        for (name in [".git", "target", "node_modules", "src", "empty", "src\\target"]) {
            Directory.create(root + "\\" + name, recursive: true)
        }
        for (name in [".git", "target", "node_modules", "src\\target"]) {
            File.writeTo(root + "\\" + name + "\\excluded.txt", "EXCLUDED".toArray())
        }
        File.writeTo(root + "\\src\\main.txt", "ORIGINAL".toArray())
        File.writeTo(root + "\\src\\模块.txt", "中文".toArray())
        File.writeTo(root + "\\binary.dat", [UInt8(0), UInt8(255), UInt8(10)])
        File.writeTo(root + "\\empty.txt", [])
    }, { snapshot, root, scope, library, profile =>
        @Expect(snapshot.capture().size, Int64(64))
        @Expect(snapshot.skipped.size, Int64(4))
        @Expect(snapshot.skipped.contains("src/target"), true)
        @Expect(exists(scope.path + "\\.git") || exists(scope.path + "\\target") || exists(scope.path + "\\node_modules"), false)
        @Expect(File.readFrom(scope.path + "\\binary.dat"), [UInt8(0), UInt8(255), UInt8(10)])
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\src\\模块.txt")), "中文")
        @ExpectThrows[Exception](snapshot.capture())
        @ExpectThrows[Exception](snapshot.assertFresh("current", "another-task", "private-request", 1))
        @ExpectThrows[Exception](snapshot.assertFresh("another-session", "private-task", "private-request", 1))
        @ExpectThrows[Exception](snapshot.assertFresh("current", "private-task", "another-request", 1))
        @ExpectThrows[Exception](snapshot.assertFresh("current", "private-task", "private-request", 2))
        let script = "$ErrorActionPreference='Stop';[IO.File]::WriteAllText('src\\main.txt',('C'*70000));" +
            "[IO.File]::WriteAllText('added.txt','ADDED');[IO.File]::Delete('empty.txt');"
        let facts = privateWorkspaceTask(scope, library, profile, script, snapshot: Some(snapshot),
            program: getVariable("SystemRoot").getOrThrow() + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            arguments: Some(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", shellEncodedCommand(script)]))
        @Expect(facts.exitCode, Int64(0))
        let changes = snapshot.changedFiles("current", "private-task", "private-request", 1)
        @Expect(changes.size, Int64(3))
        let kinds = HashMap<String, String>()
        for (change in changes) {
            kinds[change.path] = change.kind
            if (change.kind == "modified") { @Expect(change.beforeDigest, sha256Hex("ORIGINAL".toArray())) }
            if (change.kind == "deleted") { @Expect(change.afterDigest, ""); @Expect(change.bytes.size, Int64(0)) }
            if (change.kind == "added") { @Expect(change.beforeDigest, ""); @Expect(String.fromUtf8(change.bytes).contains("ADDED"), true) }
        }
        @Expect(kinds["src/main.txt"], "modified")
        @Expect(kinds["empty.txt"], "deleted")
        @Expect(kinds["added.txt"], "added")
        @Expect(String.fromUtf8(File.readFrom(root + "\\src\\main.txt")), "ORIGINAL")
        @Expect(exists(root + "\\added.txt"), false)
        @Expect(exists(root + "\\empty.txt"), true)
    })
}

@Test
func windowsSnapshotRejectsSourceRevisionChangesAndExistingTargetWrites() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", "BEFORE".toArray()) },
        { snapshot, root, _, _, _ =>
            @ExpectThrows[Exception](WindowsWorkspaceSnapshot(snapshot.source, snapshot.source,
                "current", "private-task", "private-request", 1))
            @ExpectThrows[Exception](snapshot.source.writeNew("forbidden.txt", []))
            @ExpectThrows[Exception](snapshot.source.bytes("../input.txt", false))
            @ExpectThrows[Exception](snapshot.source.bytes("input.txt:stream", false))
            @ExpectThrows[Exception](snapshot.source.bytes("NUL", false))
            snapshot.capture()
            @ExpectThrows[Exception](snapshot.destination.writeNew("input.txt", "OVERWRITE".toArray()))
            File.writeTo(root + "\\input.txt", "USER_EDIT".toArray())
            @ExpectThrows[Exception](snapshot.assertFresh("current", "private-task", "private-request", 1))
            @ExpectThrows[Exception](snapshot.changedFiles("current", "private-task", "private-request", 1))
            @Expect(String.fromUtf8(File.readFrom(root + "\\input.txt")), "USER_EDIT")
        })
}

@Test
func windowsSnapshotSourceEditedAfterApprovalNeverResumesTask() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", "BEFORE".toArray()) },
        { snapshot, root, scope, library, profile =>
            snapshot.capture()
            @ExpectThrows[Exception](privateWorkspaceTask(scope, library, profile, "echo MUST_NOT_RUN>result.txt",
                snapshot: Some(snapshot), beforeStart: { => File.writeTo(root + "\\input.txt", "USER_EDIT".toArray()) }))
            @Expect(exists(scope.path + "\\result.txt"), false)
            @Expect(String.fromUtf8(File.readFrom(root + "\\input.txt")), "USER_EDIT")
        })
}

@Test
func windowsSnapshotRejectsProtectedOutputBeforeExport() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", "BEFORE".toArray()) },
        { snapshot, root, scope, _, _ =>
            snapshot.capture()
            Directory.create(scope.path + "\\.git")
            @ExpectThrows[Exception](snapshot.changedFiles("current", "private-task", "private-request", 1))
            @Expect(String.fromUtf8(File.readFrom(root + "\\input.txt")), "BEFORE")
        })
}

@Test
func windowsSnapshotRejectsMultipleHardLinksBeforeCopy() {
    withWorkspaceSnapshot({ root =>
        File.writeTo(root + "\\input.txt", "LINKED".toArray())
        snapshotLinkFixture("hardlink", root)
    }, { snapshot, _, _, _, _ =>
        @ExpectThrows[Exception](snapshot.capture())
        @ExpectThrows[Exception](snapshot.changedFiles("current", "private-task", "private-request", 1))
    })
}

@Test
func windowsSnapshotRejectsJunctionAndFailedCaptureCannotBecomeValid() {
    withWorkspaceSnapshot({ root =>
        File.writeTo(root + "\\input.txt", "BEFORE".toArray())
        snapshotLinkFixture("junction", root)
    }, { snapshot, root, _, _, _ =>
        try { @ExpectThrows[Exception](snapshot.capture()) }
        finally { snapshotLinkFixture("remove-junction", root) }
        @ExpectThrows[Exception](snapshot.changedFiles("current", "private-task", "private-request", 1))
    })
}

@Test
func windowsSnapshotRejectsDepthOverflowWithoutSilentPartialSuccess() {
    withWorkspaceSnapshot({ root =>
        var path = root
        for (_ in 0..33) { path += "\\d"; Directory.create(path) }
    }, { snapshot, _, _, _, _ =>
        @ExpectThrows[Exception](snapshot.capture())
        @ExpectThrows[Exception](snapshot.changedFiles("current", "private-task", "private-request", 1))
    })
}

@Test
func windowsSnapshotRejectsOversizedFileRatherThanTruncating() {
    withWorkspaceSnapshot({ root => File.writeTo(root + "\\input.txt", Array<Byte>(8388609, repeat: 65)) },
        { snapshot, _, _, _, _ =>
            @ExpectThrows[Exception](snapshot.capture())
            @ExpectThrows[Exception](snapshot.changedFiles("current", "private-task", "private-request", 1))
        })
}

func withPrivateWorkspace(writable: Bool,
    action: (WindowsPrivateWorkspace, WindowsProcessLibrary, WindowsOwnedProfile) -> Unit): Unit {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let scope = WindowsPrivateWorkspace(library, profile, getVariable("SACODE_WINDOWS_SCOPE_PARENT").getOrThrow(),
                "sacode-workspace-cj-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}", writable)
            try { action(scope, library, profile) }
            finally {
                if (!scope.closed) {
                    let cleanup = runOwnedProcess(getVariable("SACODE_WORKSPACE_FIXTURE_NODE").getOrThrow(),
                        [getVariable("SACODE_WORKSPACE_CLEANUP_SCRIPT").getOrThrow(), scope.path], None, 5000, 1024,
                        { => false }, { _ => }).getOrThrow()
                    @Expect(cleanup.exitCode, Int64(0))
                    @Expect(cleanup.stdout.contains("SACODE_WORKSPACE_FIXTURE_CLEANUP confirmed"), true)
                }
                scope.close()
                scope.close()
                @Expect(exists(scope.path), false)
            }
        } finally { library.close() }
    } finally { profile.close() }
}

func privateWorkspaceTask(scope: WindowsPrivateWorkspace, library: WindowsProcessLibrary,
    profile: WindowsOwnedProfile, script: String, snapshot!: ?WindowsWorkspaceSnapshot = None,
    program!: String = "", arguments!: ?Array<String> = None, beforeStart!: () -> Unit = { => },
    afterReview!: (ExecutionService, AttachmentStore, ApprovalDesk, ExecutionSnapshot) -> Unit = { _, _, _, _ => }): ShellResult {
    let directory = scope.requireReady()
    let executable = if (program.size > 0) { program } else { getVariable("SystemRoot").getOrThrow() + "\\System32\\cmd.exe" }
    let argv = JsonArray()
    for (value in arguments ?? ["/d", "/s", "/c", script]) { argv.add(JsonString(value)) }
    let log = SessionLog(getVariable("TEMP").getOrThrow() + "\\private-task-${ownProcessId()}-${windowsOwnedProfileSequence.fetchAdd(1)}.log")
    let lease = WriteLease(log.path)
    @Expect(lease.acquire(), true)
    try {
        SessionWorkspace(log).setDirectory(directory)
        let service = ExecutionService(log, lease, "current")
        let proposal = "{\"workspaceRevision\":1,\"cwd\":\"${jsonEscapeText(directory)}\",\"executable\":\"${jsonEscapeText(executable)}\",\"argv\":${argv.toString()},\"timeoutMs\":5000,\"outputLimit\":64}"
        let state = service.propose("private-task", "private-request", proposal)
        let desk = ApprovalDesk(log)
        if (let Some(value) <- snapshot) {
            let oldArguments = service.approvalArguments(state.id)
            let oldTicket = desk.askForCall("execution/start", oldArguments)
            @Expect(desk.answer(oldTicket, "allowed-once"), true)
            @ExpectThrows[Exception](value.settledChanges(log, lease, state))
            let before = log.snapshotEvents().size
            let stale = ExecutionSnapshot(state.id, state.sessionId, state.taskId, state.requestId,
                state.proposal, state.revision + 1, state.phase, state.result)
            @ExpectThrows[Exception](value.record(log, lease, stale))
            @Expect(log.snapshotEvents().size, before)
            value.record(log, lease, state)
            value.record(log, lease, state)
            @Expect(service.approvalArguments(state.id) != oldArguments, true)
            @ExpectThrows[Exception](service.authorize(state.id, state.revision, oldTicket, desk))
            @Expect(service.describe(state.id).phase, "awaiting-approval")
            @Expect(service.workspaceSnapshot(state.id).contains(value.digest), true)
            let query = "{\"sessionId\":\"current\",\"executionId\":\"${state.id}\"}"
            let projected = JsonValue.fromStr(ExecutionApi(service, desk, "current").dispatch("execution/describe", query)).asObject()
            @Expect(projected.get("workspaceSnapshot").getOrThrow().asString().getValue(), service.workspaceSnapshot(state.id))
            @Expect(projected.get("approvalArguments").getOrThrow().asString().getValue(), service.approvalArguments(state.id))
            let replay = SessionLog(log.path)
            @Expect(replay.load(), true)
            var found: Int64 = 0
            for (event in replay.snapshotEvents()) {
                if (event.eventType != "execution/workspace-snapshot") { continue }
                let receipt = JsonValue.fromStr(event.data).asObject()
                @Expect(receipt.get("executionId").getOrThrow().asString().getValue(), state.id)
                @Expect(receipt.get("manifestDigest").getOrThrow().asString().getValue(), value.digest)
                @Expect(receipt.get("proposalDigest").getOrThrow().asString().getValue(), state.digest)
                @Expect(event.data.contains("ORIGINAL"), false)
                found += 1
            }
            @Expect(found, Int64(1))
        }
        let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
        @Expect(desk.answer(ticket, "allowed-once"), true)
        let admitted = service.authorize(state.id, state.revision, ticket, desk)
        if (let Some(value) <- snapshot) {
            let before = log.snapshotEvents().size
            @ExpectThrows[Exception](value.record(log, lease, admitted))
            @Expect(log.snapshotEvents().size, before)
        }
        beforeStart()
        let provider = WindowsExecutionProcessProvider(library, profile,
            acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()),
            state.proposal, beforeResume: { =>
                if (let Some(value) <- snapshot) { value.assertFresh("current", "private-task", "private-request", 1) }
            })
        try {
            let facts = ExecutionSupervisor(service, providerReady: { => true }, processProvider: Some(provider)).run(
                admitted.id, admitted.revision)
            let terminal = service.describe(state.id)
            @Expect(terminal.phase, "exited")
            if (let Some(value) <- snapshot) {
                @ExpectThrows[Exception](value.settledChanges(log, lease, admitted))
                let before = log.snapshotEvents().size
                @Expect(value.settledChanges(log, lease, terminal).size, Int64(3))
                let replay = SessionLog(log.path)
                @Expect(replay.load(), true)
                @Expect(value.settledChanges(replay, lease, terminal).size, Int64(3))
                @Expect(log.snapshotEvents().size, before)
                let store = AttachmentStore(log.path + ".objects", log, AttachmentLimits.localBackend())
                let review = value.recordReview(log, lease, terminal, store)
                @Expect(value.recordReview(log, lease, terminal, store), review)
                let data = JsonValue.fromStr(review).asObject()
                @Expect(data.get("executionId").getOrThrow().asString().getValue(), state.id)
                let rows = data.get("files").getOrThrow().asArray()
                var index: Int64 = 0
                while (let Some(item) <- rows.get(index)) {
                    let row = item.asObject()
                    for (side in ["before", "after"]) {
                        let ref = row.get(side + "Object").getOrThrow().asString().getValue()
                        if (ref.size > 0) {
                            @Expect(sha256Hex(store.read(ref)), row.get(side + "Digest").getOrThrow().asString().getValue())
                        }
                    }
                    index += 1
                }
                @Expect(index, Int64(3))
                let reader = ExecutionApi(service, desk, "current", reviewStore: Some(store))
                let request = JsonObject()
                request.put("sessionId", JsonString("current")); request.put("executionId", JsonString(state.id))
                request.put("revision", JsonInt(terminal.revision)); request.put("path", JsonString("src/main.txt"))
                request.put("side", JsonString("after"))
                let preview = JsonValue.fromStr(reader.dispatch("execution/review-file", request.toString())).asObject()
                @Expect(preview.get("truncated").getOrThrow().asBool().getValue(), true)
                @Expect(preview.get("totalBytes").getOrThrow().asInt().getValue(), Int64(70000))
                @Expect(preview.get("returnedBytes").getOrThrow().asInt().getValue(), Int64(65536))
                request.put("side", JsonString("before"))
                @Expect(JsonValue.fromStr(reader.dispatch("execution/review-file", request.toString())).asObject().get("truncated").getOrThrow().asBool().getValue(), false)
                request.put("revision", JsonInt(terminal.revision + 1))
                @ExpectThrows[Exception](reader.dispatch("execution/review-file", request.toString()))
                request.put("revision", JsonInt(terminal.revision)); request.put("path", JsonString("../secret"))
                @ExpectThrows[Exception](reader.dispatch("execution/review-file", request.toString()))
                request.put("path", JsonString("src/main.txt")); request.put("side", JsonString("other"))
                @ExpectThrows[Exception](reader.dispatch("execution/review-file", request.toString()))
                let saved = SessionLog(log.path)
                @Expect(saved.load(), true)
                var count: Int64 = 0
                for (event in saved.snapshotEvents()) {
                    if (event.eventType == "execution/review") { @Expect(event.data, review); count += 1 }
                }
                @Expect(count, Int64(1))
                @Expect(ExecutionService(saved, lease, "current").review(state.id), review)
                let projected = JsonValue.fromStr(ExecutionApi(service, desk, "current").dispatch("execution/describe", "{\"sessionId\":\"current\",\"executionId\":\"${state.id}\"}")).asObject()
                @Expect(projected.get("review").getOrThrow().asString().getValue(), review)
                @Expect(review.contains("ORIGINAL") || review.contains("ADDED"), false)
                // 任务结束后切回原目录，证明历史快照与差异仍可只读回放。
                SessionWorkspace(log).setDirectory(value.source.path)
                @Expect(log.durableCheckpoint(lease), true)
                afterReview(service, store, desk, terminal)
            }
            return facts
        } finally { provider.cleanup() }
    } finally { lease.release() }
}

@Test
func windowsPrivateWorkspaceTaskWritesOnlyPrivateFilesAndRetainsPreview() {
    withPrivateWorkspace(true, { scope, library, profile =>
        @ExpectThrows[Exception](library.close())
        @ExpectThrows[Exception](profile.close())
        let original = getVariable("TEMP").getOrThrow() + "\\original-${ownProcessId()}.txt"
        File.writeTo(original, "ORIGINAL".toArray())
        // 显式合成夹具字节；这不是生产工作区快照或自动合入实现。
        File.writeTo(scope.requireReady() + "\\input.txt", File.readFrom(original))
        let facts = privateWorkspaceTask(scope, library, profile, "echo CHANGED>input.txt& echo RESULT>result.txt")
        @Expect(facts.exitCode, Int64(0))
        @Expect(facts.exitObserved && facts.outputComplete, true)
        @Expect(String.fromUtf8(File.readFrom(original)), "ORIGINAL")
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\input.txt")).contains("CHANGED"), true)
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\result.txt")).contains("RESULT"), true)
        var blocked = false
        try { scope.close() } catch (e: Exception) { blocked = e.message.startsWith("windows-workspace-revoke:") }
        @Expect(blocked, true)
        @Expect(scope.requireReady(), scope.path)
    })
}

@Test
func windowsPrivateWorkspaceReadOnlyTaskCannotOverwriteSeededFile() {
    withPrivateWorkspace(false, { scope, library, profile =>
        File.writeTo(scope.requireReady() + "\\input.txt", "UNCHANGED".toArray())
        let facts = privateWorkspaceTask(scope, library, profile, "echo CORRUPT>input.txt")
        @Expect(facts.exitCode != 0, true)
        @Expect(facts.exitObserved && facts.outputComplete, true)
        @Expect(String.fromUtf8(File.readFrom(scope.path + "\\input.txt")), "UNCHANGED")
    })
}

@Test
func windowsPrivateWorkspaceRejectedCreationReleasesBorrowedOwners() {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            @ExpectThrows[Exception](WindowsPrivateWorkspace(library, profile, "relative",
                "sacode-workspace-cj-invalid", true))
            // finally 中两个 close 都必须成功，不能把失败创建留下的引用当成仍在用。
        } finally { library.close() }
    } finally { profile.close() }
}

func withWindowsSupervisor(name: String, script: String,
    action: (ExecutionSupervisor, ExecutionService, ExecutionSnapshot, SessionLog, WriteLease) -> Unit): Unit {
    let path = getVariable("TEMP").getOrThrow() + "\\supervisor-${name}-${ownProcessId()}.log"
    let log = SessionLog(path)
    let lease = WriteLease(path)
    @Expect(lease.acquire(), true)
    try {
        let directory = canonicalize(getVariable("SystemRoot").getOrThrow() + "\\System32").toString()
        let executable = directory + "\\cmd.exe"
        SessionWorkspace(log).setDirectory(directory)
        let service = ExecutionService(log, lease, "native-session")
        let proposal = "{\"workspaceRevision\":1,\"cwd\":\"${jsonEscapeText(directory)}\",\"executable\":\"${jsonEscapeText(executable)}\",\"argv\":[\"/d\",\"/s\",\"/c\",\"${jsonEscapeText(script)}\"],\"timeoutMs\":5000,\"outputLimit\":64}"
        let state = service.propose("native-task", "native-request", proposal)
        let desk = ApprovalDesk(log)
        let ticket = desk.askForCall("execution/start", service.approvalArguments(state.id))
        @Expect(desk.answer(ticket, "allowed-once"), true)
        let admitted = service.authorize(state.id, state.revision, ticket, desk)
        let profile = WindowsOwnedProfile()
        try {
            let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
            try {
                let provider = WindowsExecutionProcessProvider(library, profile,
                    acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()),
                    state.proposal)
                try {
                    let runner = ExecutionSupervisor(service, providerReady: { => true }, processProvider: Some(provider))
                    action(runner, service, admitted, log, lease)
                } finally { provider.cleanup() }
            } finally { library.close() }
        } finally { profile.close() }
    } finally { lease.release() }
}

@Test
func windowsSupervisorNativeExitOutputAndReplayUseOneLog() {
    withWindowsSupervisor("exit", "echo NATIVE_TASK_OUT& echo NATIVE_TASK_ERR 1>&2& exit /b 7",
        { runner, service, state, log, lease =>
            let facts = runner.run(state.id, state.revision)
            @Expect(facts.exitCode, Int64(7))
            @Expect(facts.stdout.contains("NATIVE_TASK_OUT") && facts.stderr.contains("NATIVE_TASK_ERR"), true)
            @Expect(facts.exitObserved && facts.outputComplete, true)
            @Expect(service.describe(state.id).phase, "exited")
            @ExpectThrows[Exception](runner.run(state.id, state.revision))
            let reloaded = SessionLog(log.path)
            @Expect(reloaded.load(), true)
            let replay = ExecutionService(reloaded, lease, "native-session")
            @Expect(replay.describe(state.id).phase, "exited")
            @Expect(replay.describe(state.id).result, service.describe(state.id).result)
            @Expect(replay.output(state.id, -1, 16).contains("stdout"), true)
            @ExpectThrows[Exception](ExecutionSupervisor(replay, providerReady: { => true }).run(
                state.id, replay.describe(state.id).revision))
        })
}

@Test
func windowsSupervisorNativeStopSettlesWithoutSuccess() {
    withWindowsSupervisor("stop", "for /L %i in (1,1,2147483647) do @rem",
        { runner, service, state, _, _ =>
            let run = runner.start(state.id, state.revision)
            for (_ in 0..200) {
                if (service.describe(state.id).phase == "running") { break }
                sleep(10 * Duration.millisecond)
            }
            let running = service.describe(state.id)
            @Expect(running.phase, "running")
            service.stop(state.id, running.revision)
            let facts = run.wait(timeoutMs: 5000)
            @Expect(facts.cancelled && facts.exitObserved && facts.outputComplete, true)
            let settled = service.describe(state.id)
            @Expect(settled.phase, "exited")
            @Expect(JsonValue.fromStr(settled.result).asObject().get("processSucceeded").getOrThrow().asBool().getValue(), false)
        })
}

@Test
func windowsArgumentEncodingPreservesQuotesSlashesAndEmpty() {
    @Expect(windowsProcessArgument(""), "\"\"")
    @Expect(windowsProcessArgument("a b"), "\"a b\"")
    @Expect(windowsProcessArgument("a\\"), "\"a\\\\\"")
    @Expect(windowsProcessArgument("a\"b"), "\"a\\\"b\"")
    @ExpectThrows[Exception](windowsProcessArgument("a\u{0}b"))
}

@Test
func windowsProviderRejectsEveryChangedApprovedProcessFieldBeforeCreation() {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let environment = acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow())
            let proposal = "{\"executable\":\"C:/approved.exe\",\"cwd\":\"C:/approved\",\"argv\":[\"first\",\"second\"],\"timeoutMs\":5000,\"outputLimit\":64}"
            for (index in 0..7) {
                let provider = WindowsExecutionProcessProvider(library, profile, environment, proposal)
                let token = TurnToken()
                // 已取消也必须先检查提案，不能把错误绑定伪装为正常取消。
                token.cancel()
                let request = ExecutionProcessRequest(
                    if (index == 0) { "C:/other.exe" } else { "C:/approved.exe" },
                    if (index == 2) { ["changed", "second"] } else if (index == 3) { ["first"] }
                    else if (index == 6) { ["second", "first"] } else { ["first", "second"] },
                    if (index == 1) { "C:/other" } else { "C:/approved" },
                    if (index == 4) { 5001 } else { 5000 },
                    if (index == 5) { 65 } else { 64 }, token,
                    { _ => throw Exception("unexpected-process-created") },
                    { _ => throw Exception("unexpected-process-started") })
                var reason = ""
                try { provider.execute(request) } catch (e: Exception) { reason = e.message }
                @Expect(reason, "windows-process-proposal-mismatch")
                provider.cleanup()
            }
            let provider = WindowsExecutionProcessProvider(library, profile, environment, proposal)
            let token = TurnToken()
            token.cancel()
            let request = ExecutionProcessRequest("C:/approved.exe", ["first", "second"], "C:/approved", 5000, 64,
                token, { _ => }, { _ => })
            @Expect(provider.execute(request).isNone(), true)
            @ExpectThrows[Exception](provider.execute(request))
            provider.cleanup()
        } finally { library.close() }
    } finally { profile.close() }
}

class WindowsFixtureRejectedProvider <: ExecutionProcessProvider {
    public func execute(_: ExecutionProcessRequest): ?ShellResult {
        throw Exception("fixture-provider-rejected")
    }
}

@Test
func windowsSupervisorProviderExceptionSettlesUnknownAndDefaultGatePreservesApproval() {
    withWindowsSupervisor("rejected", "echo MUST_NOT_RUN", { _, service, state, _, _ =>
        let provider = WindowsFixtureRejectedProvider()
        let gated = ExecutionSupervisor(service, processProvider: Some(provider))
        @ExpectThrows[Exception](gated.run(state.id, state.revision))
        @Expect(service.describe(state.id).phase, "admitted")
        let runner = ExecutionSupervisor(service, providerReady: { => true }, processProvider: Some(provider))
        @ExpectThrows[Exception](runner.run(state.id, state.revision))
        @Expect(service.describe(state.id).phase, "unknown")
        @Expect(service.describe(state.id).result, "provider-start-failed")
    })
}

func adapterExit(process: WindowsNativeProcess): UInt32 {
    for (_ in 0..200) {
        if (let Some(code) <- process.poll(timeoutMs: 50)) { return code }
    }
    throw Exception("adapter-test-exit-timeout")
}

func adapterTree(process: WindowsNativeProcess): Unit {
    for (_ in 0..500) {
        if (process.active() == 0) { return }
        sleep(10 * Duration.millisecond)
    }
    throw Exception("adapter-test-tree-timeout")
}

func withAdapterOwned(script: String, action: (WindowsNativeProcess) -> Unit): Unit {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let system = getVariable("SystemRoot").getOrThrow() + "\\System32"
            let application = system + "\\cmd.exe"
            let environment = acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow())
            let creation = library.create(application, "\"${application}\" /d /c ${script}", system, environment, profile)
            if (creation.error != 0) {
                if (let Some(p) <- creation.process) { p.stop(); adapterTree(p); p.close() }
                throw Exception("adapter-test-create:${creation.error}")
            }
            let process = creation.process.getOrThrow()
            try { action(process) }
            finally {
                process.stop()
                adapterTree(process)
                process.close()
            }
        } finally { library.close() }
    } finally { profile.close() }
}

func withAdapterProcess(script: String, limit: Int64,
    action: (WindowsNativeProcess, Future<ShellCapture>, Future<ShellCapture>) -> Unit): Unit {
    withAdapterOwned(script, { process =>
        let stdout = spawn { => readShellBounded(process.pipe(1), limit: limit) }
        let stderr = spawn { => readShellBounded(process.pipe(2), limit: limit) }
        try { action(process, stdout, stderr) }
        finally {
            process.stop()
            adapterTree(process)
            stdout.get(3000 * Duration.millisecond)
            stderr.get(3000 * Duration.millisecond)
        }
    })
}

@Test
func windowsCollectorPreservesCallbacksExitAndBoundedOutput() {
    withAdapterOwned("\"for /L %i in (1,1,2000) do @echo collected-output\"", { process =>
        let created = AtomicBool(false)
        let started = AtomicBool(false)
        let result = collectWindowsProcess(process, TurnToken(), 5000, 32,
            { _ => created.store(true); @Expect(process.poll().isNone(), true) },
            { _ => @Expect(created.load(), true); started.store(true) })
        @Expect(created.load() && started.load(), true)
        @Expect(result.exitCode, Int64(0))
        @Expect(result.exitObserved && result.outputComplete && result.stdoutTruncated, true)
        @Expect(result.stdout.size <= 32, true)
        @Expect(result.cancelled || result.timedOut, false)
    })
}

@Test
func windowsCollectorCancelledBeforeResumeNeverCallsStarted() {
    withAdapterOwned("echo MUST_NOT_RUN", { process =>
        let token = TurnToken()
        token.cancel()
        let started = AtomicBool(false)
        let result = collectWindowsProcess(process, token, 5000, 32, { _ => }, { _ => started.store(true) })
        @Expect(started.load(), false)
        @Expect(result.cancelled && result.exitObserved && result.outputComplete, true)
        @Expect(result.stdout.size + result.stderr.size, Int64(0))
    })
}

@Test
func windowsCollectorTimeoutStopsActualProcessAndDrains() {
    withAdapterOwned("for /L %i in (1,1,2147483647) do @rem", { process =>
        let result = collectWindowsProcess(process, TurnToken(), 100, 32, { _ => }, { _ => })
        @Expect(result.timedOut && result.exitObserved && result.outputComplete, true)
        @Expect(result.cancelled, false)
        @Expect(process.active(), UInt32(0))
    })
}

@Test
func windowsCollectorFailedCreatedReceiptStopsWithoutResume() {
    withAdapterOwned("echo MUST_NOT_RUN", { process =>
        var rejected = false
        let started = AtomicBool(false)
        try {
            collectWindowsProcess(process, TurnToken(), 5000, 32,
                { _ => throw Exception("fixture-persist-failed") }, { _ => started.store(true) })
        } catch (e: Exception) { rejected = e.message == "fixture-persist-failed" }
        @Expect(rejected, true)
        @Expect(started.load(), false)
        @Expect(adapterExit(process), UInt32(143))
    })
}

@Test
func windowsAdapterUsesActualPipesExitAndResourceOwnership() {
    withAdapterProcess("\"echo CJ_OUT& echo CJ_ERR 1>&2\"", 65536, { process, stdout, stderr =>
        @Expect(process.pid > 0, true)
        @Expect(process.poll().isNone(), true)
        var profileBlocked = false
        try { process.profile.close() } catch (e: Exception) { profileBlocked = e.message == "windows-profile-in-use" }
        @Expect(profileBlocked, true)
        var libraryBlocked = false
        try { process.library.close() } catch (e: Exception) { libraryBlocked = e.message == "windows-process-library-in-use" }
        @Expect(libraryBlocked, true)
        @Expect(process.resume(TurnToken()), true)
        @Expect(adapterExit(process), UInt32(0))
        let out = stdout.get(3000 * Duration.millisecond)
        let err = stderr.get(3000 * Duration.millisecond)
        @Expect(out.text.contains("CJ_OUT"), true)
        @Expect(err.text.contains("CJ_ERR"), true)
        @Expect(out.complete && err.complete, true)
    })
}

@Test
func windowsAdapterCancelledStartNeverResumesAndPipesReachEof() {
    withAdapterProcess("echo MUST_NOT_RUN", 65536, { process, stdout, stderr =>
        let token = TurnToken()
        token.cancel()
        @Expect(process.resume(token), false)
        @Expect(adapterExit(process), UInt32(143))
        let out = stdout.get(3000 * Duration.millisecond)
        let err = stderr.get(3000 * Duration.millisecond)
        @Expect(out.text.size + err.text.size, Int64(0))
        @Expect(out.complete && err.complete, true)
    })
}

@Test
func windowsAdapterKeepsDrainingAfterCaptureLimit() {
    withAdapterProcess("for /L %i in (1,1,2000) do @echo adapter-output", 32, { process, stdout, stderr =>
        @Expect(process.resume(TurnToken()), true)
        @Expect(adapterExit(process), UInt32(0))
        let out = stdout.get(3000 * Duration.millisecond)
        let err = stderr.get(3000 * Duration.millisecond)
        @Expect(out.truncated, true)
        @Expect(out.text.size <= 32, true)
        @Expect(out.complete && err.complete, true)
    })
}

@Test
func windowsAdapterConcurrentStopUnblocksBothReadersAndConfirmsExit() {
    withAdapterProcess("for /L %i in (1,1,2147483647) do @rem", 32, { process, stdout, stderr =>
        let token = TurnToken()
        @Expect(process.resume(token), true)
        let stopping = spawn { => token.cancel(); process.stop() }
        stopping.get(3000 * Duration.millisecond)
        @Expect(adapterExit(process), UInt32(143))
        adapterTree(process)
        @Expect(stdout.get(3000 * Duration.millisecond).complete, true)
        @Expect(stderr.get(3000 * Duration.millisecond).complete, true)
    })
}

@Test
func windowsAdapterFailedCreateReleasesProfileAndLibraryReferences() {
    let profile = WindowsOwnedProfile()
    try {
        let library = WindowsProcessLibrary(getVariable("SACODE_WINDOWS_PROCESS_DLL").getOrThrow())
        try {
            let system = getVariable("SystemRoot").getOrThrow() + "\\System32"
            let missing = "${system}\\SaCode-missing-${ownProcessId()}.exe"
            let result = library.create(missing, "\"${missing}\"", system,
                acProbeEnvironment(getVariable("LOCALAPPDATA").getOrThrow(), getVariable("SystemRoot").getOrThrow()), profile)
            if (let Some(process) <- result.process) { process.stop(); adapterTree(process); process.close() }
            @Expect(result.error != 0, true)
            @Expect(result.process.isNone(), true)
            // Both close calls below must succeed: a failed create must not retain references.
        } finally { library.close() }
    } finally { profile.close() }
}
