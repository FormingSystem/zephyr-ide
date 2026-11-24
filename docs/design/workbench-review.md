# Zephyr IDE workbench review

[简体中文](workbench-review.zh-cn.md)

The baseline was preview `b605864`. The review followed the path from choosing an application to configuring a build, switching tools and selecting modules.

| Observation | Change | Verification |
| --- | --- | --- |
| An empty source folder offered Configure. A failed first configure could leave a cache that enabled Build. | Explain the missing CMakeLists.txt beside the source selector. Check the cached application and generated target directory list before enabling build actions. | Exercised empty and valid sources in VS Code. Covered cache-only, generated and mismatched directories in tests. Configured and compiled HC32F4A0 hello_world from the UI using local modules and SDK and checked for zephyr/zephyr.elf. |
| Changing build methods discarded unsubmitted definitions. | Retain a draft per application and build directory in the workbench editor. | Typed BOARD and CONF_FILE, visited west and returned. Both entries survived. A different target received a separate draft. |
| The browse controls shared a name. Long directory names crowded the form, method buttons resembled unrelated actions and the empty build view repeated Add Build and Add Test. | Name each control, group the method buttons, align the paths, show workspace-relative labels with full-path tooltips and provide one pair of project actions. | Checked English and Chinese in both Modern themes. At a 790 × 718 editor viewport the short project page fits. Lists with two entries fit and lists with 80 entries scroll independently. |
| The selected modules need to stay visible while the next search is being edited. | Document the existing filter and selection behavior with a local demonstration. | Read a workspace manifest, filtered for cms, selected cmsis_6 and changed the search to hstm32. The selected revision remained above the results. |
| Two installers streamed and hashed files separately. Selectors and webview state updates also duplicated logic. | Share SHA-256 computation, named state access and the selector template. Keep caller-specific validation in each installer. | Compiled both TypeScript targets and ran lint, extension unit tests and Python west project tests. |

The [English guide](../../resources/workbench.md) and [Chinese guide](../../resources/workbench.zh-cn.md) each include two locally packaged animations. The extension host unit suite had 549 passing and 22 pending tests. The six Python west tests passed. In separate English and Chinese VS Code profiles, the extension installed from the VSIX opened the guide and decoded both images. Directory and build actions stayed within the editor at widths of 458 and 456 pixels respectively.

Windows was used for the interactive checks. Linux, macOS, hardware flashing and probe debugging were outside this verification run.
