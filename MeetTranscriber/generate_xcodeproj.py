#!/usr/bin/env python3
"""Generate MeetTranscriber.xcodeproj/project.pbxproj from source file list."""

import hashlib
import os

TARGET = "MeetTranscriber"
BUNDLE_ID = "com.meettranscriber.app"

SOURCE_FILES = [
    ("App/MeetTranscriberApp.swift", "MeetTranscriberApp.swift"),
    ("Views/ContentView.swift", "ContentView.swift"),
    ("Views/HomeView.swift", "HomeView.swift"),
    ("Views/TranscriptView.swift", "TranscriptView.swift"),
    ("Views/HistoryView.swift", "HistoryView.swift"),
    ("Views/SettingsView.swift", "SettingsView.swift"),
    ("Views/URLInputView.swift", "URLInputView.swift"),
    ("Views/RecordingIndicator.swift", "RecordingIndicator.swift"),
    ("Services/TranscriptionService.swift", "TranscriptionService.swift"),
    ("Services/AudioRecorder.swift", "AudioRecorder.swift"),
    ("Services/TranscriptStore.swift", "TranscriptStore.swift"),
    ("Services/KeychainHelper.swift", "KeychainHelper.swift"),
    ("Models/Transcript.swift", "Transcript.swift"),
]


def uid(name: str) -> str:
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def generate_pbxproj() -> str:
    # UUIDs
    proj = uid("PBXProject")
    main_grp = uid("MainGroup")
    app_grp = uid("AppGroup")
    views_grp = uid("ViewsGroup")
    services_grp = uid("ServicesGroup")
    models_grp = uid("ModelsGroup")
    products_grp = uid("ProductsGroup")
    product_ref = uid("ProductRef.app")
    target = uid("NativeTarget")
    src_phase = uid("SourcesPhase")
    fw_phase = uid("FrameworksPhase")
    res_phase = uid("ResourcesPhase")
    proj_cfg_list = uid("ProjectConfigList")
    tgt_cfg_list = uid("TargetConfigList")
    dbg_proj = uid("DebugProject")
    rel_proj = uid("ReleaseProject")
    dbg_tgt = uid("DebugTarget")
    rel_tgt = uid("ReleaseTarget")
    info_ref = uid("InfoPlist")

    file_refs = {name: uid(f"FileRef:{name}") for _, name in SOURCE_FILES}
    build_files = {name: uid(f"BuildFile:{name}") for _, name in SOURCE_FILES}

    def grp_files(prefix):
        return [(p, n) for p, n in SOURCE_FILES if p.startswith(prefix)]

    L = []

    def w(s=""):
        L.append(s)

    w("// !$*UTF8*$!")
    w("{")
    w("\tarchiveVersion = 1;")
    w("\tclasses = {")
    w("\t};")
    w("\tobjectVersion = 56;")
    w("\tobjects = {")
    w()

    # PBXBuildFile
    w("/* Begin PBXBuildFile section */")
    for _, name in SOURCE_FILES:
        w(f"\t\t{build_files[name]} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_refs[name]} /* {name} */; }};")
    w("/* End PBXBuildFile section */")
    w()

    # PBXFileReference
    w("/* Begin PBXFileReference section */")
    w(f"\t\t{info_ref} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; }};")
    w(f"\t\t{product_ref} /* {TARGET}.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = {TARGET}.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
    for _, name in SOURCE_FILES:
        w(f"\t\t{file_refs[name]} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = \"<group>\"; }};")
    w("/* End PBXFileReference section */")
    w()

    # PBXFrameworksBuildPhase
    w("/* Begin PBXFrameworksBuildPhase section */")
    w(f"\t\t{fw_phase} /* Frameworks */ = {{")
    w("\t\t\tisa = PBXFrameworksBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
    w("/* End PBXFrameworksBuildPhase section */")
    w()

    # PBXGroup
    w("/* Begin PBXGroup section */")

    def write_group(gid, name, path, children_ids_names):
        w(f"\t\t{gid} /* {name} */ = {{")
        w("\t\t\tisa = PBXGroup;")
        w("\t\t\tchildren = (")
        for cid, cname in children_ids_names:
            w(f"\t\t\t\t{cid} /* {cname} */,")
        w("\t\t\t);")
        if path:
            w(f"\t\t\tpath = {path};")
        else:
            w(f"\t\t\tname = {name};")
        w("\t\t\tsourceTree = \"<group>\";")
        w("\t\t};")

    # Main group — path = TARGET (source folder name)
    w(f"\t\t{main_grp} = {{")
    w("\t\t\tisa = PBXGroup;")
    w("\t\t\tchildren = (")
    w(f"\t\t\t\t{app_grp} /* App */,")
    w(f"\t\t\t\t{views_grp} /* Views */,")
    w(f"\t\t\t\t{services_grp} /* Services */,")
    w(f"\t\t\t\t{models_grp} /* Models */,")
    w(f"\t\t\t\t{info_ref} /* Info.plist */,")
    w(f"\t\t\t\t{products_grp} /* Products */,")
    w("\t\t\t);")
    w(f"\t\t\tpath = {TARGET};")
    w("\t\t\tsourceTree = \"<group>\";")
    w("\t\t};")

    write_group(products_grp, "Products", None, [(product_ref, f"{TARGET}.app")])
    write_group(app_grp, "App", "App", [(file_refs[n], n) for _, n in grp_files("App/")])
    write_group(views_grp, "Views", "Views", [(file_refs[n], n) for _, n in grp_files("Views/")])
    write_group(services_grp, "Services", "Services", [(file_refs[n], n) for _, n in grp_files("Services/")])
    write_group(models_grp, "Models", "Models", [(file_refs[n], n) for _, n in grp_files("Models/")])

    w("/* End PBXGroup section */")
    w()

    # PBXNativeTarget
    w("/* Begin PBXNativeTarget section */")
    w(f"\t\t{target} /* {TARGET} */ = {{")
    w("\t\t\tisa = PBXNativeTarget;")
    w(f"\t\t\tbuildConfigurationList = {tgt_cfg_list} /* Build configuration list for PBXNativeTarget \"{TARGET}\" */;")
    w("\t\t\tbuildPhases = (")
    w(f"\t\t\t\t{src_phase} /* Sources */,")
    w(f"\t\t\t\t{fw_phase} /* Frameworks */,")
    w(f"\t\t\t\t{res_phase} /* Resources */,")
    w("\t\t\t);")
    w("\t\t\tbuildRules = (")
    w("\t\t\t);")
    w("\t\t\tdependencies = (")
    w("\t\t\t);")
    w(f"\t\t\tname = {TARGET};")
    w(f"\t\t\tproductName = {TARGET};")
    w(f"\t\t\tproductReference = {product_ref} /* {TARGET}.app */;")
    w("\t\t\tproductType = \"com.apple.product-type.application\";")
    w("\t\t};")
    w("/* End PBXNativeTarget section */")
    w()

    # PBXProject
    w("/* Begin PBXProject section */")
    w(f"\t\t{proj} /* Project object */ = {{")
    w("\t\t\tisa = PBXProject;")
    w("\t\t\tattributes = {")
    w("\t\t\t\tBuildIndependentTargetsInParallel = 1;")
    w("\t\t\t\tLastSwiftUpdateCheck = 1500;")
    w("\t\t\t\tLastUpgradeCheck = 1500;")
    w("\t\t\t\tTargetAttributes = {")
    w(f"\t\t\t\t\t{target} = {{")
    w("\t\t\t\t\t\tCreatedOnToolsVersion = 15.0;")
    w("\t\t\t\t\t};")
    w("\t\t\t\t};")
    w("\t\t\t};")
    w(f"\t\t\tbuildConfigurationList = {proj_cfg_list} /* Build configuration list for PBXProject \"{TARGET}\" */;")
    w("\t\t\tcompatibilityVersion = \"Xcode 14.0\";")
    w("\t\t\tdevelopmentRegion = fr;")
    w("\t\t\thasScannedForEncodings = 0;")
    w("\t\t\tknownRegions = (")
    w("\t\t\t\ten,")
    w("\t\t\t\tfr,")
    w("\t\t\t\tBase,")
    w("\t\t\t);")
    w(f"\t\t\tmainGroup = {main_grp};")
    w(f"\t\t\tproductRefGroup = {products_grp} /* Products */;")
    w("\t\t\tprojectDirPath = \"\";")
    w("\t\t\tprojectRoot = \"\";")
    w("\t\t\ttargets = (")
    w(f"\t\t\t\t{target} /* {TARGET} */,")
    w("\t\t\t);")
    w("\t\t};")
    w("/* End PBXProject section */")
    w()

    # PBXResourcesBuildPhase
    w("/* Begin PBXResourcesBuildPhase section */")
    w(f"\t\t{res_phase} /* Resources */ = {{")
    w("\t\t\tisa = PBXResourcesBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
    w("/* End PBXResourcesBuildPhase section */")
    w()

    # PBXSourcesBuildPhase
    w("/* Begin PBXSourcesBuildPhase section */")
    w(f"\t\t{src_phase} /* Sources */ = {{")
    w("\t\t\tisa = PBXSourcesBuildPhase;")
    w("\t\t\tbuildActionMask = 2147483647;")
    w("\t\t\tfiles = (")
    for _, name in SOURCE_FILES:
        w(f"\t\t\t\t{build_files[name]} /* {name} in Sources */,")
    w("\t\t\t);")
    w("\t\t\trunOnlyForDeploymentPostprocessing = 0;")
    w("\t\t};")
    w("/* End PBXSourcesBuildPhase section */")
    w()

    # XCBuildConfiguration
    w("/* Begin XCBuildConfiguration section */")

    def base_settings():
        return [
            "ALWAYS_SEARCH_USER_PATHS = NO;",
            "CLANG_ANALYZER_NONNULL = YES;",
            "CLANG_CXX_LANGUAGE_STANDARD = \"gnu++20\";",
            "CLANG_ENABLE_MODULES = YES;",
            "CLANG_ENABLE_OBJC_ARC = YES;",
            "CLANG_ENABLE_OBJC_WEAK = YES;",
            "CLANG_WARN_BLOCK_CAPTURE_AUTORELEASING = YES;",
            "CLANG_WARN_BOOL_CONVERSION = YES;",
            "CLANG_WARN_COMMA = YES;",
            "CLANG_WARN_CONSTANT_CONVERSION = YES;",
            "CLANG_WARN_DEPRECATED_OBJC_IMPLEMENTATIONS = YES;",
            "CLANG_WARN_DIRECT_OBJC_ISA_USAGE = YES_ERROR;",
            "CLANG_WARN_EMPTY_BODY = YES;",
            "CLANG_WARN_ENUM_CONVERSION = YES;",
            "CLANG_WARN_INFINITE_RECURSION = YES;",
            "CLANG_WARN_INT_CONVERSION = YES;",
            "CLANG_WARN_NON_LITERAL_NULL_CONVERSION = YES;",
            "CLANG_WARN_OBJC_IMPLICIT_RETAIN_SELF = YES;",
            "CLANG_WARN_OBJC_LITERAL_CONVERSION = YES;",
            "CLANG_WARN_OBJC_ROOT_CLASS = YES_ERROR;",
            "CLANG_WARN_RANGE_LOOP_ANALYSIS = YES;",
            "CLANG_WARN_STRICT_PROTOTYPES = YES;",
            "CLANG_WARN_SUSPICIOUS_MOVE = YES;",
            "CLANG_WARN_UNGUARDED_AVAILABILITY = YES_AGGRESSIVE;",
            "CLANG_WARN_UNREACHABLE_CODE = YES;",
            "CLANG_WARN__DUPLICATE_METHOD_DECL = YES;",
            "COPY_PHASE_STRIP = NO;",
            "ENABLE_STRICT_OBJC_MSGSEND = YES;",
            "GCC_C_LANGUAGE_STANDARD = gnu17;",
            "GCC_NO_COMMON_BLOCKS = YES;",
            "GCC_WARN_64_TO_32_BIT_CONVERSION = YES;",
            "GCC_WARN_ABOUT_RETURN_TYPE = YES_ERROR;",
            "GCC_WARN_UNDECLARED_SELECTOR = YES;",
            "GCC_WARN_UNINITIALIZED_AUTOS = YES_AGGRESSIVE;",
            "GCC_WARN_UNUSED_FUNCTION = YES;",
            "GCC_WARN_UNUSED_VARIABLE = YES;",
            "IPHONEOS_DEPLOYMENT_TARGET = 16.0;",
            "MTL_FAST_MATH = YES;",
            "SDKROOT = iphoneos;",
        ]

    def write_cfg(cfg_id, name, extra_settings):
        w(f"\t\t{cfg_id} /* {name} */ = {{")
        w("\t\t\tisa = XCBuildConfiguration;")
        w("\t\t\tbuildSettings = {")
        for s in extra_settings:
            w(f"\t\t\t\t{s}")
        w("\t\t\t};")
        w(f"\t\t\tname = {name};")
        w("\t\t};")

    write_cfg(dbg_proj, "Debug", base_settings() + [
        "DEBUG_INFORMATION_FORMAT = dwarf;",
        "ENABLE_TESTABILITY = YES;",
        "GCC_DYNAMIC_NO_PIC = NO;",
        "GCC_OPTIMIZATION_LEVEL = 0;",
        "GCC_PREPROCESSOR_DEFINITIONS = (DEBUG=1, \"$(inherited)\",);",
        "MTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;",
        "ONLY_ACTIVE_ARCH = YES;",
        "SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;",
        "SWIFT_OPTIMIZATION_LEVEL = \"-Onone\";",
    ])

    write_cfg(rel_proj, "Release", base_settings() + [
        "DEBUG_INFORMATION_FORMAT = \"dwarf-with-dsym\";",
        "ENABLE_NS_ASSERTIONS = NO;",
        "SWIFT_COMPILATION_MODE = wholemodule;",
        "SWIFT_OPTIMIZATION_LEVEL = \"-O\";",
        "VALIDATE_PRODUCT = YES;",
    ])

    target_base = [
        f"PRODUCT_BUNDLE_IDENTIFIER = {BUNDLE_ID};",
        "CURRENT_PROJECT_VERSION = 1;",
        f"INFOPLIST_FILE = {TARGET}/Info.plist;",
        "IPHONEOS_DEPLOYMENT_TARGET = 16.0;",
        "MARKETING_VERSION = 1.0;",
        "PRODUCT_NAME = \"$(TARGET_NAME)\";",
        "SDKROOT = iphoneos;",
        "SUPPORTED_PLATFORMS = iphoneos;",
        "SWIFT_EMIT_LOC_STRINGS = YES;",
        "SWIFT_VERSION = 5.0;",
        "TARGETED_DEVICE_FAMILY = 1;",
    ]
    write_cfg(dbg_tgt, "Debug", target_base)
    write_cfg(rel_tgt, "Release", target_base)

    w("/* End XCBuildConfiguration section */")
    w()

    # XCConfigurationList
    w("/* Begin XCConfigurationList section */")

    w(f"\t\t{proj_cfg_list} /* Build configuration list for PBXProject \"{TARGET}\" */ = {{")
    w("\t\t\tisa = XCConfigurationList;")
    w("\t\t\tbuildConfigurations = (")
    w(f"\t\t\t\t{dbg_proj} /* Debug */,")
    w(f"\t\t\t\t{rel_proj} /* Release */,")
    w("\t\t\t);")
    w("\t\t\tdefaultConfigurationIsVisible = 0;")
    w("\t\t\tdefaultConfigurationName = Release;")
    w("\t\t};")

    w(f"\t\t{tgt_cfg_list} /* Build configuration list for PBXNativeTarget \"{TARGET}\" */ = {{")
    w("\t\t\tisa = XCConfigurationList;")
    w("\t\t\tbuildConfigurations = (")
    w(f"\t\t\t\t{dbg_tgt} /* Debug */,")
    w(f"\t\t\t\t{rel_tgt} /* Release */,")
    w("\t\t\t);")
    w("\t\t\tdefaultConfigurationIsVisible = 0;")
    w("\t\t\tdefaultConfigurationName = Release;")
    w("\t\t};")

    w("/* End XCConfigurationList section */")
    w()

    w("\t};")
    w(f"\trootObject = {proj} /* Project object */;")
    w("}")

    return "\n".join(L)


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    xcodeproj = os.path.join(base, f"{TARGET}.xcodeproj")
    workspace = os.path.join(xcodeproj, "project.xcworkspace")
    os.makedirs(workspace, exist_ok=True)

    pbxproj_path = os.path.join(xcodeproj, "project.pbxproj")
    with open(pbxproj_path, "w", encoding="utf-8") as f:
        f.write(generate_pbxproj())
    print(f"Generated: {pbxproj_path}")

    workspace_data = '''\
<?xml version="1.0" encoding="UTF-8"?>
<Workspace version="1.0">
   <FileRef location="self:">
   </FileRef>
</Workspace>
'''
    ws_path = os.path.join(workspace, "contents.xcworkspacedata")
    with open(ws_path, "w", encoding="utf-8") as f:
        f.write(workspace_data)
    print(f"Generated: {ws_path}")


if __name__ == "__main__":
    main()
