#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
CoordMode "Mouse", "Screen"
SetKeyDelay 50, 50

; ============================================
; PARAVIDEOS_STORY_PAT1.AHK
; 1) pega imagens de C:\Users\USER\Desktop\ParaVideos
; 2) cria lotes de 10
; 3) sobe lote por lote
; 4) espera 60s
; 5) faz os cliques de limpeza/apagamento
; 6) depois processa 1 por 1 no estilo pat1
; 7) para cada item envia zz1pat
; ============================================

F8::ExitApp()

; ============================================
; CONFIG
; ============================================
SOURCE_DIR := A_ScriptDir
BASE_DIR   := A_ScriptDir "\.."
TEMP_ROOT  := SOURCE_DIR "\_story_temp"
DONE_DIR   := SOURCE_DIR "\_enviados"
BATCH_SIZE := 10
WAIT_BETWEEN_BATCHES := 30000

FINAL_TEXTO := "zz1pat"
OMASCOTE_BOT := BASE_DIR "\omascote-bot.ahk"

; ============================================
; STORY - COORDENADAS
; ============================================
STORY_CLICK1_X := 535
STORY_CLICK1_Y := 662
STORY_SLEEP1 := 345

STORY_CLICK2_X := 457
STORY_CLICK2_Y := 684
STORY_SLEEP2 := 1890

STORY_CLICK3_X := 716
STORY_CLICK3_Y := 269
STORY_SLEEP3 := 3203

STORY_CLICK4_X := 702
STORY_CLICK4_Y := 54
STORY_SLEEP4 := 1523

STORY_SLEEP_AFTER_PATH := 1031
STORY_SLEEP_AFTER_ENTER1 := 2578

STORY_CLICK5_X := 809
STORY_CLICK5_Y := 369
STORY_SLEEP5 := 1891

STORY_SLEEP_AFTER_CTRL_A := 797
STORY_SLEEP_AFTER_ENTER2 := 1609

; limpeza/apagamento depois dos 60s
POST_WAIT_CLICK_X := 467
POST_WAIT_CLICK_Y := 642
POST_WAIT_CLICK_COUNT := 14
POST_WAIT_SLEEP_MIN := 780
POST_WAIT_SLEEP_MAX := 900

; ============================================
; PAT1 - COORDENADAS
; ============================================
CLICK1_X := 517
CLICK1_Y := 669
SLEEP_AFTER_CLICK1 := 820

CLICK2_X := 455
CLICK2_Y := 681
SLEEP_AFTER_CLICK2 := 1043

TEXTBOX_FIRST_X := 609
TEXTBOX_FIRST_Y := 268

TEXTBOX_NEXT_X := 553
TEXTBOX_NEXT_Y := 229

SLEEP_AFTER_PASTE := 280
SLEEP_AFTER_ENTER := 420
SLEEP_AFTER_ESC := 300
SLEEP_AFTER_ZZ1PAT := 900

; ============================================
; VALIDAR PASTA
; ============================================
if !DirExist(SOURCE_DIR) {
    MsgBox "Não achei a pasta:`n" SOURCE_DIR, "ParaVideos", 16
    ExitApp
}

DirCreate(DONE_DIR)

try {
    if DirExist(TEMP_ROOT)
        DirDelete(TEMP_ROOT, true)
}
DirCreate(TEMP_ROOT)

; ============================================
; LISTA IMAGENS
; ============================================
fileList := ""

Loop Files, SOURCE_DIR "\*.*", "F" {
    name := A_LoopFileName
    SplitPath name, , , &ext
    extL := StrLower(ext)

    if (extL = "png" || extL = "jpg" || extL = "jpeg" || extL = "webp") {
        low := StrLower(name)

        if (low = "xxxx.png")
            continue
        if (low = "story.ahk" || low = "pat1.ahk" || low = "paravideos_story_pat1.ahk")
            continue

        fileList .= name "`n"
    }
}

if (fileList = "") {
    MsgBox "Nenhuma imagem encontrada em:`n" SOURCE_DIR, "ParaVideos", 48
    ExitApp
}

fileList := Sort(fileList)
lines := StrSplit(fileList, ["`r`n", "`n", "`r"])

; ============================================
; CRIA LOTES
; ============================================
batchNum := 1
itemCount := 0
currentBatchDir := ""

for _, raw in lines {
    name := Trim(raw)
    if (name = "")
        continue

    if (itemCount = 0) {
        currentBatchDir := TEMP_ROOT "\lote_" Format("{:03}", batchNum)
        DirCreate(currentBatchDir)
    }

    src := SOURCE_DIR "\" name
    dst := currentBatchDir "\" name
    try FileCopy(src, dst, 1)

    itemCount++

    if (itemCount >= BATCH_SIZE) {
        batchNum++
        itemCount := 0
    }
}

; ============================================
; LISTA LOTES
; ============================================
batchDirs := ""

Loop Files, TEMP_ROOT "\lote_*", "D" {
    batchDirs .= A_LoopFileFullPath "`n"
}

if (batchDirs = "") {
    MsgBox "Nenhum lote foi criado em:`n" TEMP_ROOT, "ParaVideos", 48
    ExitApp
}

batchDirs := Sort(batchDirs)
batchLines := StrSplit(batchDirs, ["`r`n", "`n", "`r"])

totalBatches := 0
for _, raw in batchLines {
    if (Trim(raw) != "")
        totalBatches++
}

if (totalBatches = 0) {
    MsgBox "Nenhum lote válido encontrado.", "ParaVideos", 48
    ExitApp
}

; ============================================
; ETAPA 1 - SOBE LOTE POR LOTE
; ============================================
currentIndex := 0

for _, raw in batchLines {
    lotePath := Trim(raw)
    if (lotePath = "")
        continue

    currentIndex++

    Click STORY_CLICK1_X, STORY_CLICK1_Y
    Sleep STORY_SLEEP1

    Click STORY_CLICK2_X, STORY_CLICK2_Y
    Sleep STORY_SLEEP2

    Click STORY_CLICK3_X, STORY_CLICK3_Y
    Sleep STORY_SLEEP3

    Click STORY_CLICK4_X, STORY_CLICK4_Y
    Sleep STORY_SLEEP4

    SendText lotePath
    Sleep STORY_SLEEP_AFTER_PATH

    Send "{Enter}"
    Sleep STORY_SLEEP_AFTER_ENTER1

    Click STORY_CLICK5_X, STORY_CLICK5_Y
    Sleep STORY_SLEEP5

    Send "^a"
    Sleep STORY_SLEEP_AFTER_CTRL_A

    Send "{Enter}"
    Sleep STORY_SLEEP_AFTER_ENTER2

    ; depois de cada lote:
    ; espera 60s e faz a limpeza/apagamento
    Sleep WAIT_BETWEEN_BATCHES

    Loop POST_WAIT_CLICK_COUNT {
        Click POST_WAIT_CLICK_X, POST_WAIT_CLICK_Y
        Sleep Random(POST_WAIT_SLEEP_MIN, POST_WAIT_SLEEP_MAX)
    }
}

; ============================================
; ETAPA 2 - PAT1 1 POR 1 + zz1pat
; ============================================
isFirstItem := true

for _, raw in lines {
    line := Trim(raw)
    if (line = "")
        continue

    OpenInputAndPaste(line, isFirstItem)
    isFirstItem := false
    Sleep SLEEP_AFTER_PASTE

    Send "{Enter}"
    Sleep 300
    Sleep SLEEP_AFTER_ENTER

    Send "{Esc}"
    Sleep SLEEP_AFTER_ESC

    OpenInputAndPaste(FINAL_TEXTO, false)
    Sleep SLEEP_AFTER_PASTE

    Send "{Enter}"
    Sleep SLEEP_AFTER_ZZ1PAT
}

; ============================================
; MOVE PROCESSADOS
; ============================================
MoveEverythingExceptControlFiles(SOURCE_DIR, DONE_DIR)

try {
    if DirExist(TEMP_ROOT)
        DirDelete(TEMP_ROOT, true)
}

RunOmascoteBot()
ExitApp

; ============================================
; FUNÇÕES
; ============================================
OpenInputAndPaste(txt, isFirstOfSet := false) {
    global CLICK1_X, CLICK1_Y, SLEEP_AFTER_CLICK1
    global CLICK2_X, CLICK2_Y, SLEEP_AFTER_CLICK2
    global TEXTBOX_FIRST_X, TEXTBOX_FIRST_Y
    global TEXTBOX_NEXT_X, TEXTBOX_NEXT_Y

    ClipSaved := ClipboardAll()
    A_Clipboard := ""
    A_Clipboard := txt
    ClipWait 1

    Click CLICK1_X, CLICK1_Y
    Sleep SLEEP_AFTER_CLICK1

    Click CLICK2_X, CLICK2_Y
    Sleep SLEEP_AFTER_CLICK2

    if (isFirstOfSet) {
        Click TEXTBOX_FIRST_X, TEXTBOX_FIRST_Y
    } else {
        Click TEXTBOX_NEXT_X, TEXTBOX_NEXT_Y
    }

    Sleep 180
    Send "^v"
    Sleep 240

    A_Clipboard := ClipSaved
}

MoveEverythingExceptControlFiles(sourceDir, doneDir) {
    DirCreate(doneDir)

    Loop Files, sourceDir "\*", "F" {
        name := A_LoopFileName
        src  := A_LoopFileFullPath
        dst  := doneDir "\" name
        low  := StrLower(name)

        if (low = "story.ahk" || low = "pat1.ahk" || low = "paravideos_story_pat1.ahk")
            continue

        try {
            if FileExist(dst)
                FileDelete(dst)
            FileMove(src, dst, 1)
        }
    }

    Loop Files, sourceDir "\*", "D" {
        name := A_LoopFileName
        src  := A_LoopFileFullPath
        dst  := doneDir "\" name
        low  := StrLower(name)

        if (low = "_story_temp" || low = "_enviados")
            continue

        try {
            if DirExist(dst)
                DirDelete(dst, true)
            DirMove(src, dst)
        }
    }
}

RunOmascoteBot() {
    global OMASCOTE_BOT

    if (!FileExist(OMASCOTE_BOT))
        return false

    try {
        Run('"' A_AhkPath '" "' OMASCOTE_BOT '"')
        return true
    } catch {
        return false
    }
}