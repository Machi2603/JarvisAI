param([string]$Output = "training\jarvis\synthetic_negatives")

Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force $Output | Out-Null
$phrases = @(
  'abre el calendario', 'que tiempo hace hoy', 'pon música tranquila', 'dime la hora',
  'necesito una respuesta rápida', 'busca información sobre tecnología', 'envía un mensaje',
  'apaga la luz del salón', 'recuérdame llamar mañana', 'cuánto falta para llegar',
  'buenos días, cómo estás', 'quiero preparar la cena', 'elige una película',
  'cuéntame una historia corta', 'haz una lista de tareas', 'abre mi correo',
  'vamos a caminar un rato', 'qué noticias hay hoy', 'necesito concentrarme',
  'programa una alarma', 'guarda esta nota', 'cierra la ventana', 'sube el volumen',
  'baja el volumen', 'puedes ayudarme', 'dónde están mis llaves', 'voy a llegar tarde',
  'me gustaría aprender algo nuevo', 'revisa el documento', 'mañana será un buen día'
)
$voices = @('Microsoft Helena Desktop', 'Microsoft Zira Desktop')
$index = 0
foreach ($voice in $voices) {
  foreach ($rate in @(-2, 0, 2)) {
    foreach ($phrase in $phrases) {
      $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
      $s.SelectVoice($voice); $s.Rate = $rate
      $s.SetOutputToWaveFile((Join-Path $Output ("negative_{0:D3}.wav" -f $index)))
      $s.Speak($phrase); $s.Dispose(); $index++
    }
  }
}
Write-Output "Created $index negative clips"
