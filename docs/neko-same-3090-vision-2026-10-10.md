# Vision encoder on the same RTX 3090

The later [game role configuration](neko-game-role-reasoning-2026-10-10.md)
enables bounded low reasoning for code generation only. Chat, vision and the
server-wide default retain the no-thinking setting recorded here.

The local Strata service previously ran the existing Qwen visual projection on
CPU (eight threads), with the language model using GPU 0, an RTX 3090. The user
requested moving the visual projection to that same card. No additional model,
provider, GPU or Minecraft task was introduced.

The existing Strata configuration now sets `vision.gpu=true` and
`vision.cuda_device=0`. The encoder's `--gpu` command line is present in the
running process. Strata's source maps the explicit device to
`CUDA_VISIBLE_DEVICES=0`; the language engine also reports RTX 3090. The existing
Qwen model, BF16 projection, 262,144-token context limit, no-thinking setting and
512-token image ceiling remain in use. Neko's chat/code/vision profile still
points to the same local endpoint, `http://127.0.0.1:18030/v1`.

A temporary GPU 0 encoder was measured alongside the resident language model
before changing the service. The same saved 1280-wide Minecraft image used in
the previous CPU test produced 480 image tokens:

| Measurement | CPU baseline | Same RTX 3090 |
| --- | ---: | ---: |
| First encoding of that image | 5,118 ms | 350 ms |
| Cached image encoding | <1 ms | 1 ms |
| First 640-wide image encoding | 3,649 ms | 51 ms |

These are encoding-only timings, after encoder startup. They exclude screenshot
capture, language-model prompt reading, answer generation and request queues.

The service restarted at 02:35:31 on 2026-10-10 after both the model and body
were idle. The existing guardian started the replacement local service. Strata
loads the visual encoder before sizing its automatic expert cache, retaining
space for both. The previous configuration was backed up locally. The model
health endpoint confirmed `loaded=true` and `images=true` after startup.

End-to-end API probes after deployment used existing saved images and generated
no Minecraft actions or chat:

| API request | Total time | Output tokens |
| --- | ---: | ---: |
| New red/blue shape image | 1,657 ms | 11 |
| New Minecraft screenshot | 3,890 ms | 160 |
| Same screenshot, cached | 1,887 ms | 160 |

The shape answer identified the red shape on the left and blue circle on the
right. Both screenshot answers hit the diagnostic output limit; these timings
are not a guarantee for longer answers, long agent context or browser capture.
The cache request reused 531 of 538 prompt tokens as well as the image embedding,
so its improvement includes both caches. This is latency/transport evidence,
not a benchmark of game-state interpretation accuracy.

After these requests, `nvidia-smi` reported 23,297 MiB used and 1,030 MiB free on
the 3090. The engine separately reported 538 MiB free after its graph captures;
driver and CUDA accounting differ. Neko remained connected with 20 health and
20 food, the native body process stayed running, the guardian returned to
`running`, and the LAN viewer returned HTTP 200. A subsequent autonomous local
model turn processed 11,224 prompt tokens and generated 218 tokens without a
restart or inference error. Long-context and sustained unattended behavior were
not stress-tested by these short probes.
