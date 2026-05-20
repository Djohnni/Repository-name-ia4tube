#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
CoordMode "Mouse", "Screen"
SetKeyDelay 50, 50

; =========================
; PAT1
; =========================

; =========================
; PARAR EMERGÊNCIA
; =========================
F8::ExitApp()

; =========================
; CONFIG
; =========================
IMAGES_DIR  := "C:\IA4tube\prontoPARAimagem"
DONE_DIR    := "C:\IA4tube\prontoPARAimagem2"
ACTIONS_OUT := "C:\IA4tube\acoes.txt"

; ✅ Seus cliques + sleeps
CLICK1_X := 488
CLICK1_Y := 657
SLEEP_AFTER_CLICK1 := 820

CLICK2_X := 458
CLICK2_Y := 681
SLEEP_AFTER_CLICK2 := 1043

; ✅ tempos extras
SLEEP_AFTER_PASTE := 120
SLEEP_AFTER_ENTER := 420
SLEEP_AFTER_ZZ1PAT := 900

FINAL_TEXTO := "zz1pat"
currentTipoFinal := "zz1pat"

; =========================
; PARTE 1: GERAR acoes.txt
; =========================
if !DirExist(IMAGES_DIR) {
    MsgBox "Não achei a pasta:`n" IMAGES_DIR, "pat1", 16
    ExitApp
}

DirCreate(DONE_DIR)

fileList := ""

Loop Files, IMAGES_DIR "\*.*", "F" {
    name := A_LoopFileName
    SplitPath name, , , &ext
    extL := StrLower(ext) ; png/jpg/jpeg/webp

    if (extL = "png" || extL = "jpg" || extL = "jpeg" || extL = "webp") {
        fileList .= name "`n"
    }
}

if (fileList = "") {
    MsgBox "Nenhuma imagem encontrada.", "pat1", 48
    ExitApp
}

; ordena alfabeticamente
fileList := Sort(fileList)

; sobrescreve acoes.txt
try FileDelete(ACTIONS_OUT)
FileAppend(fileList, ACTIONS_OUT, "UTF-8")

MsgBox "OK! acoes.txt atualizado com as imagens.", "pat1", 64

; =========================
; PARTE 2: EXECUTAR linha por linha do acoes.txt
; =========================
text := FileRead(ACTIONS_OUT, "UTF-8")
lines := StrSplit(text, ["`r`n", "`n", "`r"])

currentSet := ""
startedSet := false

for _, raw in lines {
    line := Trim(raw)
    if (line = "")
        continue

    low := StrLower(line)

    ; ignora marcador final
    if (low = "xxxx.png")
        continue

    ; identifica set e texto final do conjunto
    setCode := GetSetCodeFromLine(line)
    currentTipoFinal := GetFinalTextoFromLine(line)

    ; se mudou o setCode, abre novo conjunto
    if (setCode != "" && setCode != currentSet) {
        currentSet := setCode
        startedSet := false
    }

    ; se ainda não preparou o campo para esse conjunto, faz os 2 cliques
    if (!startedSet) {
        Click CLICK1_X, CLICK1_Y
        Sleep SLEEP_AFTER_CLICK1

        Click CLICK2_X, CLICK2_Y
        Sleep SLEEP_AFTER_CLICK2

        startedSet := true
    }

    ; se é linha _zzzz:
    if InStr(low, "_zzzz") {

        if (currentSet != "") {

            ; cola o código
            PasteLineInvisible(currentSet)
            Sleep SLEEP_AFTER_PASTE

            ; Shift + Enter
            Send "+{Enter}"
            Sleep 323

            ; escreve final correto
            SendText currentTipoFinal
            Sleep 502

            ; Enter final
            Send "{Enter}"
            Sleep SLEEP_AFTER_ZZ1PAT
        }

        startedSet := false
        continue
    }

    ; caso normal: ANTES DE CADA LINHA, faz os 2 cliques
    Click CLICK1_X, CLICK1_Y
    Sleep SLEEP_AFTER_CLICK1

    Click CLICK2_X, CLICK2_Y
    Sleep SLEEP_AFTER_CLICK2

    PasteLineInvisible(line)
    Sleep SLEEP_AFTER_PASTE
    Send "{Enter}"
    Sleep 300
    Sleep SLEEP_AFTER_ENTER
    Send "{Esc}"
    Sleep 300
}

; =========================
; PARTE 3: MOVER TUDO DE prontoPARAimagem
; PARA prontoPARAimagem2, MENOS story.ahk
; =========================
MoveEverythingExceptStory(IMAGES_DIR, DONE_DIR)

ExitApp

; =========================
; FUNÇÕES
; =========================
PasteLineInvisible(txt) {
    ClipSaved := ClipboardAll()
    A_Clipboard := ""
    A_Clipboard := txt
    ClipWait 1
    Send "^v"
    Sleep 40
    A_Clipboard := ClipSaved
}

GetSetCodeFromLine(line) {
    ; pega os 3 primeiros blocos separados por " - "
    ; ex: 15991120599 - fs - 20260227_224020 - escudo1.png
    parts := StrSplit(line, " - ")
    if (parts.Length < 3)
        return ""
    return Trim(parts[1]) " - " Trim(parts[2]) " - " Trim(parts[3])
}

GetFinalTextoFromLine(line) {
    low := StrLower(line)

    if InStr(low, " - mascote - ")
        return "zz1pat"
    if InStr(low, " - fs - ")
        return "zz1fs"
    if InStr(low, " - fm - ")
        return "zz1fm"
    if InStr(low, " - ft - ")
        return "zz1ft"
    if InStr(low, " - fj - ")
        return "zz1fj"
    if InStr(low, " - contratacao1 - ")
        return "zz1contratacao1"

    return "zz1pat"
}

MoveEverythingExceptStory(sourceDir, doneDir) {
    DirCreate(doneDir)

    ; move arquivos, menos story.ahk
    Loop Files, sourceDir "\*", "F" {
        name := A_LoopFileName
        src  := A_LoopFileFullPath
        dst  := doneDir "\" name

        if (StrLower(name) = "story.ahk")
            continue

        try {
            if FileExist(dst)
                FileDelete(dst)
            FileMove(src, dst, 1)
        }
    }

    ; move pastas também
    Loop Files, sourceDir "\*", "D" {
        name := A_LoopFileName
        src  := A_LoopFileFullPath
        dst  := doneDir "\" name

        try {
            if DirExist(dst)
                DirDelete(dst, true)
            DirMove(src, dst)
        }
    }
}