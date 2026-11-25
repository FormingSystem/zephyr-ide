# SPDX-License-Identifier: Apache-2.0
"""Read editable scalar properties from Zephyr's generated devicetree."""
import json
from pathlib import Path
import sys


def property_editor(prop, dtlib):
    if prop.type == dtlib.Type.EMPTY:
        return "flag", "y"
    if prop.type == dtlib.Type.NUM:
        return "cell", str(prop.to_num())
    if prop.type == dtlib.Type.STRING:
        return "string", prop.to_string()
    return None


def catalog(source, zephyr_base):
    sys.path.insert(0, str(zephyr_base / "scripts/dts/python-devicetree/src"))
    from devicetree import dtlib

    for node in dtlib.DT(str(source)).node_iter():
        options = {"status": ("string", node.props["status"].to_string()
                              if "status" in node.props else "okay")}
        for name, prop in node.props.items():
            # Node identity, addressing and references need binding-aware editors.
            if name in ("phandle", "linux,phandle", "reg", "compatible") or name.startswith("#"):
                continue
            editor = property_editor(prop, dtlib)
            if editor:
                options[name] = editor
        for name, (kind, value) in options.items():
            item = dict(id=node.path + ":" + name, label=name, group=node.path,
                        type=kind, value=value)
            if name == "status":
                item["choices"] = list(dict.fromkeys(["okay", "disabled", value]))
            elif kind == "flag":
                item["choices"] = ["y", "n"]
            yield item


if __name__ == "__main__":
    print(json.dumps(list(catalog(Path(sys.argv[1]), Path(sys.argv[2])))))
