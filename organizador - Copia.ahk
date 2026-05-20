#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon
Persistent

; ==========================================
; IA4TUBE - HANDOFF PARA AHK GERADOR (PASTA ÚNICA)
; - Pausa bot baixador com F8 (APENAS 1 VEZ) e NÃO retoma
; - Extrai ZIP, lê pedido.json (UTF-8), gera info.txt + info_story.png
; - Copia TUDO para prontoPARAimagem\ (SEM subpastas)
; - Renomeia: WHATS - TIPO - ID - nome.ext
;   1) No final de CADA pedido: duplica a "última imagem" com _<TIPO>_zzzz
;   2) No final do ciclo (quando processar >=1 pedido normal): cria/atualiza xxxx.png
; - Se for RESULTADO: chama pipeline Python e NÃO abre story/pat1
; ==========================================

; ===== CONFIG =====
BASE_DIR          := A_ScriptDir
ORIGEM_DIR        := BASE_DIR "\Pedidos"
OUT_DIR           := BASE_DIR "\prontoPARAimagem"
TMP_DIR           := OUT_DIR "\_tmp_extract"

CHECK_EVERY_MS    := 300000      ; 5 minutos
PAUSE_KEY         := "{F8}"

LOG_FILE          := OUT_DIR "\_handoff_log.txt"
PROCESSED_FILE    := OUT_DIR "\_handoff_processed.txt"

; Campos que NUNCA entram no card/imagem
IGNORE_KEYS_CSV   := "id,whatsapp,mes,status,criado_em,patrocinadores_qtd,artilheiros"

IMG_W := 1080
IMG_H := 1920

; Script do Story (FFmpeg)
STORY_SCRIPT := OUT_DIR "\story.ahk"

; Próximo script depois do Story
NEXT_SCRIPT  := BASE_DIR "\pat1.ahk"

; Runner da fila Python
RUNNER_SCRIPT := BASE_DIR "\runner_fila.py"

; Nome do marcador local por pedido
HANDOFF_OK_FILE := "processado_handoff.txt"

; Hotkey para matar este script
F9::ExitApp

; ===== INIT =====
DirCreate(ORIGEM_DIR)
DirCreate(OUT_DIR)

Log("=== HANDOFF INICIADO ===")
Log("ORIGEM: " ORIGEM_DIR)
Log("OUT: " OUT_DIR)
Log("TMP: " TMP_DIR)
Log("CHECK_EVERY_MS: " CHECK_EVERY_MS)
Log("NEXT_SCRIPT: " NEXT_SCRIPT)

global g_pausedBot := false

EnsureRunnerAberto()

SetTimer(MainLoop, CHECK_EVERY_MS)
MainLoop()
return


; ===========================
; MAIN LOOP
; ===========================
MainLoop() {
    global STORY_SCRIPT, NEXT_SCRIPT

    try {
        stats := ProcessAllPedidos()
        nLegacy := stats.legacy
        nResultado := stats.resultado
        nSite := stats.site

        Log("Processamento finalizado. Legacy: " nLegacy " | Resultados: " nResultado " | Site: " nSite)

        CleanupTmpRoot()

        ; só abre story/pat1 se houve processamento legacy
        if (nLegacy > 0) {
            Log("Abrindo STORY e aguardando finalizar: " STORY_SCRIPT)
            try RunWait STORY_SCRIPT

            Log("STORY finalizou. Abrindo próximo script: " NEXT_SCRIPT)
            try Run NEXT_SCRIPT

            ExitApp
        }

        ; se só teve resultado/site, encerra sem chamar story/pat1
        if (nResultado > 0 || nSite > 0) {
            Log("Somente pedidos de resultado/site processados. Não vou abrir STORY nem pat1.")
            ExitApp
        }

    } catch as e {
        Log("ERRO NO MAINLOOP: " e.Message)
    }

    ExitApp
}

; ✅ NOVO: limpa a pasta temporária inteira (o “pai” _tmp_extract)
CleanupTmpRoot() {
    global TMP_DIR
    try {
        if DirExist(TMP_DIR) {
            DirDelete(TMP_DIR, true)
            Log("TMP limpo/removido: " TMP_DIR)
        }
    } catch as e {
        Log("ATENÇÃO: falhou limpar TMP_DIR: " e.Message)
    }
}


; ===========================
; PROCESSA TODOS OS PEDIDOS
; ===========================
ProcessAllPedidos() {
    global ORIGEM_DIR, OUT_DIR, PAUSE_KEY, g_pausedBot

    countLegacy := 0
    countResultado := 0
    countSite := 0
    lastImageForXxxx := ""

    Loop Files, ORIGEM_DIR "\*", "D" {
        pedidoDir := A_LoopFileFullPath
        id := A_LoopFileName

        if (HasLocalHandoffOk(pedidoDir)) {
            Log("[" id "] IGNORADO: processado_handoff.txt já contém OK.")
            continue
        }

        if (IsProcessed(id)) {
            Log("[" id "] IGNORADO: já está em _handoff_processed.txt.")
            continue
        }

        zipPath := FindFirstZip(pedidoDir)
        if (!zipPath)
            continue

        if (!WaitFileStable(zipPath, 2, 800)) {
            Log("[" id "] ZIP ainda mudando. Vou tentar no próximo ciclo.")
            continue
        }

        if (!g_pausedBot) {
            Log("Pausando bot anterior (F8) - 1ª e única vez (somente porque encontrei pedido para processar)...")
            Send PAUSE_KEY
            Sleep 350
            g_pausedBot := true
        }

        result := ProcessPedidoZip(pedidoDir, id, zipPath)

        if IsObject(result) {
            if (result.ok) {
                MarkProcessed(id)

                if (result.tipo = "resultado") {
                    countResultado++
                } else if (result.tipo = "flayer" || result.tipo = "mascote" || result.tipo = "pedido") {
                    countLegacy++
                    if (result.lastImage)
                        lastImageForXxxx := result.lastImage
                } else {
                    countSite++
                }
            }
        }
    }

    if (countLegacy > 0) {
        EnsureXxxxMarker(OUT_DIR, lastImageForXxxx)
    }

    return { legacy: countLegacy, resultado: countResultado, site: countSite }
}

FindFirstZip(dir) {
    Loop Files, dir "\*.zip", "F" {
        return A_LoopFileFullPath
    }
    return ""
}

WaitFileStable(filePath, checks := 2, intervalMs := 800) {
    if (!FileExist(filePath))
        return false
    sizePrev := FileGetSize(filePath)
    Loop checks {
        Sleep intervalMs
        if (!FileExist(filePath))
            return false
        sizeNow := FileGetSize(filePath)
        if (sizeNow != sizePrev)
            return false
        sizePrev := sizeNow
    }
    return true
}

; ✅ NOVO: verifica se o pedido já foi marcado localmente com OK
HasLocalHandoffOk(pedidoDir) {
    global HANDOFF_OK_FILE

    markerPath := pedidoDir "\" HANDOFF_OK_FILE
    if (!FileExist(markerPath))
        return false

    try {
        txt := FileRead(markerPath, "UTF-8")
    } catch {
        try txt := FileRead(markerPath)
        catch
            return false
    }

    txt := Trim(txt, " `t`r`n")
    return InStr(StrUpper(txt), "OK") > 0
}

IsRunnerAberto() {
    try {
        wmi := ComObjGet("winmgmts:")
        query := "Select * from Win32_Process Where Name = 'python.exe' Or Name = 'pythonw.exe'"

        for proc in wmi.ExecQuery(query) {
            cmd := ""
            try cmd := proc.CommandLine

            if (InStr(StrLower(cmd), "runner_fila.py"))
                return true
        }
    } catch {
        return false
    }

    return false
}

EnsureRunnerAberto() {
    global BASE_DIR, RUNNER_SCRIPT

    if (IsRunnerAberto()) {
        Log("Runner já está aberto.")
        return true
    }

    if (!FileExist(RUNNER_SCRIPT)) {
        Log("Runner não encontrado: " RUNNER_SCRIPT)
        return false
    }

    Log("Runner não estava aberto. Abrindo agora: " RUNNER_SCRIPT)
    Run('pythonw "' RUNNER_SCRIPT '"', BASE_DIR, "Hide")

    Sleep 1000
    return true
}


; ===========================
; PROCESSA 1 PEDIDO (ZIP)
; Retorna: objeto { ok, tipo, lastImage }
; ===========================
ProcessPedidoZip(pedidoDir, id, zipPath) {
    global TMP_DIR, OUT_DIR, IGNORE_KEYS_CSV, IMG_W, IMG_H

    tmpExtract := TMP_DIR "\" id
    outLastImage := ""

    try {
        Log("[" id "] STEP 0: TMP => " tmpExtract)

        if DirExist(tmpExtract)
            DirDelete(tmpExtract, 1)
        DirCreate(tmpExtract)

        Log("[" id "] STEP 1: Expand-Archive => " zipPath)
        if (!PS_ExpandZip(zipPath, tmpExtract)) {
            Log("[" id "] ERRO: falha ao extrair ZIP.")
            return { ok: false, tipo: "", lastImage: "" }
        }

        Log("[" id "] STEP 2: localizar pedido.json")
        jsonPath := FindFileRecursive(tmpExtract, "pedido.json")
        if (!jsonPath) {
            Log("[" id "] ERRO: pedido.json não encontrado dentro do ZIP extraído.")
            return { ok: false, tipo: "", lastImage: "" }
        }

        Log("[" id "] STEP 3: ler whatsapp (UTF-8)")
        whatsapp := PS_ReadJsonField_UTF8(jsonPath, "whatsapp")
        whatsapp := Trim(whatsapp, "`r`n`t ")
        if (!whatsapp) {
            Log("[" id "] ERRO: whatsapp vazio no pedido.json.")
            return { ok: false, tipo: "", lastImage: "" }
        }

        tipo := DetectTipoPedido_UTF8(jsonPath)
        if (!tipo)
            tipo := "flayer"
        tipoSafe := MakeSafeTipo(tipo)

        ; ===== FLUXO DOS PIPELINES =====
        if (tipoSafe = "resultado" || tipoSafe = "escalacao" || tipoSafe = "contratacao" || tipoSafe = "proximo_jogo" || tipoSafe = "patrocinador" || tipoSafe = "escudo3d") {
            Log("[" id "] 🔥 " StrUpper(tipoSafe) " detectado - garantindo runner da fila aberto")

            try {
                if (!EnsureRunnerAberto()) {
                    Log("[" id "] ❌ Não consegui abrir/verificar o runner_fila.py")
                    return { ok: false, tipo: "", lastImage: "" }
                }

                Log("[" id "] ✅ Runner aberto/verificado. O pipeline será chamado somente pelo runner.")
                return { ok: true, tipo: tipoSafe, lastImage: "" }

            } catch as e {
                Log("[" id "] ❌ ERRO ao garantir runner aberto: " e.Message)
                return { ok: false, tipo: "", lastImage: "" }
            }
        }


        Log("[" id "] whatsapp=" whatsapp " | tipo=" tipoSafe)

        infoTxtTmp := tmpExtract "\info.txt"
        if FileExist(infoTxtTmp)
            try FileDelete(infoTxtTmp)

        Log("[" id "] STEP 4: escrever info.txt (Unicode) a partir do JSON UTF-8")
        if (!PS_WriteInfoFile_UTF8(jsonPath, IGNORE_KEYS_CSV, infoTxtTmp)) {
            Log("[" id "] ATENÇÃO: falhou escrever info.txt.")
        }

        infoPngTmp := tmpExtract "\info_story.png"
        if FileExist(infoPngTmp)
            try FileDelete(infoPngTmp)

        Log("[" id "] STEP 5: gerar info_story.png (Unicode)")
        if (!PS_GenerateStoryPngFromFile(infoTxtTmp, infoPngTmp, IMG_W, IMG_H)) {
            Log("[" id "] ATENÇÃO: falhou gerar info_story.png.")
        }

        Log("[" id "] STEP 6: copiar arquivos para OUT (solto + renomeado)")
        created := CopyAllAssetsFlat_ReturnList(tmpExtract, OUT_DIR, whatsapp, tipoSafe, id)

        lastDst := PickLastForZzzz(created, whatsapp, tipoSafe, id)

        if (lastDst) {
            zzzzDst := MakeZzzzName(lastDst, tipoSafe)
            try {
                FileCopy(lastDst, zzzzDst, 1)
                Log("[" id "] ZZZZ criado: " zzzzDst)
            } catch as e {
                Log("[" id "] ATENÇÃO: falhou criar _zzzz: " e.Message)
            }
            outLastImage := lastDst
        } else {
            Log("[" id "] ATENÇÃO: não achei arquivo para gerar _zzzz.")
        }

        ; grava o OK local no pedido
        try {
            FileDelete(pedidoDir "\processado_handoff.txt")
        } catch {
        }
        try FileAppend("OK", pedidoDir "\processado_handoff.txt", "UTF-8")

        Log("[" id "] OK => handoff pronto")
        return { ok: true, tipo: tipoSafe, lastImage: outLastImage }

    } catch as e {
        Log("[" id "] ERRO: " e.Message)
        return { ok: false, tipo: "", lastImage: "" }

    } finally {
        try {
            if DirExist(tmpExtract)
                DirDelete(tmpExtract, 1)
        }
    }
}


CopyAllAssetsFlat_ReturnList(srcRoot, outDir, whatsapp, tipo, id) {
    created := []

    Loop Files, srcRoot "\*", "F" {
        name := A_LoopFileName
        dst := outDir "\" whatsapp " - " tipo " - " id " - " name

        if FileExist(dst) {
            dst := outDir "\" whatsapp " - " tipo " - " id " - " A_Now " - " name
        }

        FileCopy(A_LoopFileFullPath, dst, 1)
        created.Push(dst)
    }

    Loop Files, srcRoot "\*", "D" {
        subCreated := CopyAllAssetsFlat_ReturnList(A_LoopFileFullPath, outDir, whatsapp, tipo, id)
        for _, p in subCreated
            created.Push(p)
    }

    return created
}

PickLastForZzzz(createdList, whatsapp, tipo, id) {
    if (createdList.Length = 0)
        return ""

    for _, p in createdList {
        if InStr(StrLower(p), " - info_story.png")
            return p
    }

    for _, p in createdList {
        if (StrLower(SubStr(p, -4)) = ".png")
            return p
    }

    return createdList[1]
}

MakeZzzzName(originalPath, tipoSafe) {
    SplitPath originalPath, &name, &dir, &ext, &nameNoExt

    if RegExMatch(nameNoExt, "^(.* - )(.+)$", &m) {
        prefix := m[1]
        tail   := m[2]
        if (SubStr(tail, 1, 1) != "z")
            tail := "z" tail
        base := prefix tail
    } else {
        base := nameNoExt
        if (SubStr(base, 1, 1) != "z")
            base := "z" base
    }

    suffix := "_" tipoSafe "_zzzz"
    return dir "\" base suffix "." ext
}

EnsureXxxxMarker(outDir, sourcePath) {
    try {
        dst := outDir "\xxxx.png"
        if (sourcePath && FileExist(sourcePath)) {
            FileCopy(sourcePath, dst, 1)
            Log("XXXX criado: " dst)
            return
        }
        if !FileExist(dst)
            FileAppend("", dst)
        Log("XXXX criado (fallback vazio): " dst)
    } catch as e {
        Log("ATENÇÃO: falhou criar xxxx.png: " e.Message)
    }
}

MakeSafeTipo(t) {
    t := Trim(StrLower(t))
    t := RegExReplace(t, "[^a-z0-9_]+", "")
    if (!t)
        t := "pedido"
    return t
}

DetectTipoPedido_UTF8(jsonPath) {
    t := PS_ReadJsonField_UTF8(jsonPath, "tipo_pedido")
    t := Trim(t, "`r`n`t ")
    if (t)
        return NormalizeTipo(t)

    t := PS_ReadJsonField_UTF8(jsonPath, "categoria")
    t := Trim(t, "`r`n`t ")
    if (t)
        return NormalizeTipo(t)

    ; fallback antigo, caso venha pedido velho
    masc := Trim(PS_ReadJsonField_UTF8(jsonPath, "mascote_tipo"), "`r`n`t ")
    if (masc)
        return "mascote"

    rodada := Trim(PS_ReadJsonField_UTF8(jsonPath, "rodada"), "`r`n`t ")
    data   := Trim(PS_ReadJsonField_UTF8(jsonPath, "data"), "`r`n`t ")
    hora   := Trim(PS_ReadJsonField_UTF8(jsonPath, "hora"), "`r`n`t ")
    if (rodada || data || hora)
        return "flayer"

    return "pedido"
}

NormalizeTipo(t) {
    t := Trim(StrLower(t))

    ; tipos novos do site
    if (t = "escalacao" || t = "contratacao" || t = "proximo_jogo" || t = "patrocinador" || t = "escudo3d")
        return t

    ; flyers do site (legado)
    if (t = "fs")
        return "escalacao"
    if (t = "fm")
        return "contratacao"
    if (t = "ft")
        return "proximo_jogo"
    if (t = "fj")
        return "patrocinador"

    ; flyer genérico
    if InStr(t, "fly") || InStr(t, "flay")
        return "flayer"

    ; mascote
    if InStr(t, "masc")
        return "mascote"

    ; resultado
    if InStr(t, "resultado")
        return "resultado"

    if InStr(t, "pedido")
        return "pedido"

    return t
}

FindFileRecursive(rootDir, fileName) {
    Loop Files, rootDir "\*", "FD" {
        if (A_LoopFileAttrib ~= "D") {
            found := FindFileRecursive(A_LoopFileFullPath, fileName)
            if (found)
                return found
        } else {
            if (StrLower(A_LoopFileName) = StrLower(fileName))
                return A_LoopFileFullPath
        }
    }
    return ""
}

PS_Run(psCommand) {
    tempOut := A_Temp "\organizador_ps_out_" A_TickCount ".txt"
    tempErr := A_Temp "\organizador_ps_err_" A_TickCount ".txt"
    tempPs1 := A_Temp "\organizador_ps_cmd_" A_TickCount ".ps1"

    try FileDelete(tempOut)
    try FileDelete(tempErr)
    try FileDelete(tempPs1)

    FileAppend(psCommand, tempPs1, "UTF-8")

    q := Chr(34)
    psExe := A_WinDir "\System32\WindowsPowerShell\v1.0\powershell.exe"
    cmd := q psExe q " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " q tempPs1 q " > " q tempOut q " 2> " q tempErr q

    RunWait(A_ComSpec " /c " q cmd q, , "Hide")

    stdout := ""
    stderr := ""

    try stdout := FileRead(tempOut, "UTF-8")
    try stderr := FileRead(tempErr, "UTF-8")

    try FileDelete(tempOut)
    try FileDelete(tempErr)
    try FileDelete(tempPs1)

    if (stderr && Trim(stderr))
        Log("PS STDERR: " Trim(stderr))

    return stdout
}

PS_Escape(s) {
    return StrReplace(s, "'", "''")
}

PS_ExpandZip(zipPath, destDir) {
    ps :=
    (
    "$ErrorActionPreference='Stop';"
    "Expand-Archive -Path '" PS_Escape(zipPath) "' -DestinationPath '" PS_Escape(destDir) "' -Force;"
    "'OK'"
    )
    out := Trim(PS_Run(ps), "`r`n`t ")
    return (out = "OK")
}

PS_ReadJsonField_UTF8(jsonPath, fieldName) {
    ps :=
    (
    "$ErrorActionPreference='Stop';"
    "$p='" PS_Escape(jsonPath) "';"
    "$raw=[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8);"
    "$o=$raw | ConvertFrom-Json;"
    "if($null -eq $o." fieldName "){''} else {[string]$o." fieldName "}"
    )
    return Trim(PS_Run(ps), "`r`n`t ")
}

PS_WriteInfoFile_UTF8(jsonPath, ignoreCsv, outTxtPath) {
    ps :=
    (
    "$ErrorActionPreference='Stop';"
    "$p='" PS_Escape(jsonPath) "';"
    "$out='" PS_Escape(outTxtPath) "';"
    "$raw=[System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8);"
    "$o=$raw | ConvertFrom-Json;"
    "$ignore=('"
    StrReplace(ignoreCsv, ",", "','")
    "');"
    "$pairs=@();"
    "$o.PSObject.Properties | ForEach-Object {"
        "$k=$_.Name;"
        "$v=$_.Value;"
        "if($ignore -contains $k){ return }"
        "if($null -eq $v){ return }"
        "$s=[string]$v;"
        "if([string]::IsNullOrWhiteSpace($s)){ return }"
        "$pairs += ($k.ToUpper() + ': ' + $s)"
    "};"
    "if($pairs.Count -eq 0){ $pairs=@('(Sem campos variáveis para exibir)') }"
    "$pairs -join [Environment]::NewLine | Out-File -LiteralPath $out -Encoding Unicode -Force;"
    "'OK'"
    )
    out := Trim(PS_Run(ps), "`r`n`t ")
    return (out = "OK")
}

PS_GenerateStoryPngFromFile(textFilePath, outPath, w, h) {
    pad := 80
    rectW := w - (2 * pad)
    rectH := h - (2 * pad)

    ps :=
    (
    "$ErrorActionPreference='Stop';"
    "Add-Type -AssemblyName System.Drawing;"
    "$w=" w "; $h=" h ";"
    "$pad=" pad "; $rectW=" rectW "; $rectH=" rectH ";"
    "$pTxt='" PS_Escape(textFilePath) "';"
    "$txt=[System.IO.File]::ReadAllText($pTxt, [System.Text.Encoding]::Unicode);"

    "$bmp = New-Object System.Drawing.Bitmap($w,$h);"
    "$g = [System.Drawing.Graphics]::FromImage($bmp);"
    "$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality;"
    "$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit;"
    "$g.Clear([System.Drawing.Color]::Black);"

    "$font = New-Object System.Drawing.Font('Arial', 52, [System.Drawing.FontStyle]::Bold);"
    "$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White);"

    "$rect = New-Object System.Drawing.RectangleF($pad, $pad, $rectW, $rectH);"

    "$sf = New-Object System.Drawing.StringFormat;"
    "$sf.Alignment = [System.Drawing.StringAlignment]::Near;"
    "$sf.LineAlignment = [System.Drawing.StringAlignment]::Near;"
    "$sf.Trimming = [System.Drawing.StringTrimming]::Word;"
    "$sf.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit;"

    "$g.DrawString($txt, $font, $brush, $rect, $sf);"
    "$out='" PS_Escape(outPath) "';"
    "$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png);"
    "$g.Dispose(); $bmp.Dispose();"
    "'OK'"
    )
    out := Trim(PS_Run(ps), "`r`n`t ")
    return (out = "OK")
}

Log(msg) {
    global LOG_FILE
    ts := FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss")
    FileAppend(ts " | " msg "`n", LOG_FILE, "UTF-8")
}

IsProcessed(id) {
    global PROCESSED_FILE
    if (!FileExist(PROCESSED_FILE))
        return false
    txt := "`n" FileRead(PROCESSED_FILE, "UTF-8") "`n"
    return InStr(txt, "`n" id "`n") > 0
}

MarkProcessed(id) {
    global PROCESSED_FILE
    FileAppend(id "`n", PROCESSED_FILE, "UTF-8")
}










