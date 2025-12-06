import beginRecord from "@renderer/assets/begin-record.wav"
import endRecord from "@renderer/assets/end-record.wav"

const beginAudio = new Audio(beginRecord)
const endAudio = new Audio(endRecord)

const audios = {
  begin_record: beginAudio,
  end_record: endAudio,
}

export const playSound = (sound: "begin_record" | "end_record") => {
  return new Promise<void>((resolve) => {
    const audio = audios[sound]

    audio.addEventListener("ended", () => {
      resolve()
    })

    audio.play()
  })
}
