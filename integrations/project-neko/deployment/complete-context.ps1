# Local deployment transport capacity for complete Minecraft state/receipts.
# Dot-source before starting the Neko launcher so all owned workers inherit it.
# This is a byte transport limit, not a model/token budget or silent clipping.
$env:NEKO_MESSAGE_PLANE_PAYLOAD_MAX_BYTES = '16777216'
