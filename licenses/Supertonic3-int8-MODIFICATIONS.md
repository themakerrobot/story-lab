# 수정 사항

이 폴더의 ONNX 파일은 Supertone Inc.의 Supertonic 3 모델(BigScience Open RAIL-M)을 8비트(INT8 동적 양자화, QUInt8, MatMul/Gemm/Conv 가중치, 파일 전체 32비트 유지: vocoder)로 변환한 것입니다.
- 원본: supertone-oss-archive/supertonic-3 (revision aafc6e32416a594460b32413efc49d7fe4ce6d46)
- 변환 도구: tools/convert_models.py (onnxconverter-common / onnxruntime.quantization)
- 입출력 형식과 설정(tts.json), 목소리 파일(voice_styles)은 바꾸지 않았습니다.
- 사용 제한(Attachment A)은 원본과 같이 적용됩니다.
