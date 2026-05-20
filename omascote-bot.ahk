#Requires AutoHotkey v2.0
#SingleInstance Force
#NoTrayIcon
Persistent

; ==========================================
; OMASCOTE BOT (AHK v2) - FULL REBUILD
; Baixa pedidos automaticamente via API
; ==========================================

; ===========================
; CONFIG (edite só aqui)
; ===========================
API_BASE       := "https://api.omascote.com.br"
WHATSAPP       := "15991120599"
SENHA          := "lehlinda"

CHECK_EVERY_MS := 18000  ; 18s

ROOT_DIR       := A_ScriptDir
BASE_DIR       := ROOT_DIR "\Pedidos"
SUPORTE_DIR    := ROOT_DIR "\Suporte"

STATUS_ON_PICK := "em_producao"

LOG_FILE       := BASE_DIR "\_log.txt"
PROCESSED_FILE := BASE_DIR "\_processed.txt"

; DEBUG: quando true, loga o RAW do /pedidos/novos
DEBUG_NOVOS_RAW := true

; ✅ ALTERADO (MINIMAL): organizador na MESMA PASTA deste bot
ORGANIZADOR_AHK := A_ScriptDir "\organizador.ahk"

; ===========================
; REMBG LOCAL
; ===========================
REMBG_ENABLED := true
REMBG_PYTHON  := "C:\Users\USER\AppData\Local\Python\bin\python.exe"

; ===========================
; HOTKEY PAUSE/PLAY (F8)
; ===========================
^!F8::ToggleBotPause()

ToggleBotPause() {
    global CHECK_EVERY_MS
    static paused := false
    paused := !paused

    if (paused) {
        SetTimer(MainLoop, 0)
        Log("=== BOT PAUSADO (F8) ===")
        ; TrayTip removido para modo invisível
    } else {
        SetTimer(MainLoop, CHECK_EVERY_MS)
        Log("=== BOT RETOMADO (F8) ===")
        ; TrayTip removido para modo invisível
    }
}

; ===========================
; INIT
; ===========================
DirCreate(BASE_DIR)
DirCreate(SUPORTE_DIR)
Log("=== BOT INICIADO ===")
Log("API_BASE: " API_BASE)
Log("BASE_DIR: " BASE_DIR)

global g_token := ""
global g_processed := Map()

; ✅ NOVO: trava para não abrir o organizador repetidamente no mesmo “ciclo de fila vazia”
global g_ranOrganizerForEmpty := false

LoadProcessed()

g_token := Api_LoginAndGetToken()
if (!g_token) {
    Log("ERRO: Login falhou. Encerrando.")
    Log("Login falhou. Veja o log: " LOG_FILE)
    ExitApp
}
Log("Token OK. (len=" StrLen(g_token) ")")

SetTimer(MainLoop, CHECK_EVERY_MS)
MainLoop()
return


; ===========================
; MAIN LOOP
; ===========================
MainLoop() {
    global g_token, g_processed, ORGANIZADOR_AHK, g_ranOrganizerForEmpty

    try {
        BaixarSuporteFinalizado(g_token)

        ids := Api_GetNovosIds(g_token)

        if (ids.Length = 0) {
            Log("Sem pedidos novos.")

            if (!g_ranOrganizerForEmpty) {
                Log("✅ Lista vazia: tentando rodar organizador: " ORGANIZADOR_AHK)
                RunOrganizer()
                g_ranOrganizerForEmpty := true
            }

            return
        }

        g_ranOrganizerForEmpty := false
        baixouAlgo := false

        for _, id in ids {
            id := Trim(id)
            if (!id)
                continue

            isAjuste := false

            if InStr(id, "|") {
                partesId := StrSplit(id, "|")
                id := Trim(partesId[1])
                statusPedidoServidor := partesId.Length >= 2 ? Trim(partesId[2]) : ""
                isAjuste := (statusPedidoServidor = "ajuste_pendente")
            }

            if (!isAjuste && g_processed.Has(id)) {
                Log("Ignorando (memória): " id)
                continue
            }

            if (!isAjuste && IsProcessedOnDisk(id)) {
                g_processed[id] := true
                Log("Ignorando (disco): " id)
                continue
            }

            if (isAjuste) {
                Log("AJUSTE PENDENTE detectado, rebaixando pedido já existente: " id)
            }

            Log("NOVO PEDIDO: " id)

            pedidoDir := BASE_DIR "\" id
            DirCreate(pedidoDir)

            zipPath := pedidoDir "\" id ".zip"

            if (!Api_DownloadZip(g_token, id, zipPath)) {
                Log("ERRO: Falha ao baixar ZIP: " id)
                continue
            }
            Log("ZIP baixado: " zipPath)

            baixouAlgo := true

            if (!ExtractZip(zipPath, pedidoDir)) {
                Log("ERRO: Falha ao extrair ZIP: " id)
                continue
            }
            Log("ZIP extraído: " pedidoDir)

            ; ===========================
            ; IDENTIFICAR CATEGORIA DO PEDIDO
            ; ===========================
            pedidoJsonPath := pedidoDir "\pedido.json"
            categoria := ""

            if FileExist(pedidoJsonPath) {
                try {
                    pedidoData := FileRead(pedidoJsonPath, "UTF-8")
                    if RegExMatch(pedidoData, '"categoria"\s*:\s*"(.*?)"', &m)
                        categoria := m[1]
                    else
                        categoria := ""
                } catch {
                    categoria := ""
                }
            }

            if (categoria != "") {
                FileAppend(categoria, pedidoDir "\tipo.txt", "UTF-8")
                Log("Categoria detectada: " categoria)
            } else {
                Log("Categoria NÃO detectada")
            }

            escudoExtraido := FindFileRecursiveByName(pedidoDir, "escudo2.png")
            if (escudoExtraido) {
                escudoRaiz := pedidoDir "\escudo2.png"

                try {
                    if (FileExist(escudoRaiz) && escudoExtraido != escudoRaiz)
                        FileDelete(escudoRaiz)
                } catch {
                }

                if (escudoExtraido != escudoRaiz) {
                    try {
                        FileCopy(escudoExtraido, escudoRaiz, 1)
                        Log("ESCUDO2 puxado para raiz do pedido: " escudoRaiz)
                    } catch as e {
                        Log("ERRO ao copiar escudo2 para raiz: " e.Message)
                    }
                }
            } else {
                Log("ATENÇÃO: escudo2.png não encontrado dentro da extração.")
            }

            ProcessOrderImages_Rembg(pedidoDir)

            if (!Api_UpdateStatus(g_token, id, STATUS_ON_PICK)) {
                Log("ATENÇÃO: baixou/extraiu mas status falhou: " id)
            } else {
                Log("Status atualizado: " id " => " STATUS_ON_PICK)
            }

            if (!isAjuste) {
                g_processed[id] := true
                AppendProcessed(id)
            }
        }

        if (baixouAlgo) {
            Log("✅ Baixou pedido(s) neste ciclo. Tentando rodar organizador: " ORGANIZADOR_AHK)
            RunOrganizer()
            g_ranOrganizerForEmpty := true
            return
        }

        if (!baixouAlgo) {
            if (!g_ranOrganizerForEmpty) {
                Log("✅ Nenhum pedido novo para baixar (todos já processados). Tentando rodar organizador: " ORGANIZADOR_AHK)
                RunOrganizer()
                g_ranOrganizerForEmpty := true
            }
            return
        }

    } catch as e {
        Log("ERRO NO LOOP: " e.Message)
        Log("Tentando relogar...")
        newToken := Api_LoginAndGetToken()
        if (newToken) {
            g_token := newToken
            Log("Relog OK.")
        } else {
            Log("Relog falhou.")
        }
    }
}

; ===========================
; RUN DO ORGANIZADOR
; ===========================
RunOrganizer() {
    global ORGANIZADOR_AHK

    if (!FileExist(ORGANIZADOR_AHK)) {
        Log("ERRO: organizador não encontrado: " ORGANIZADOR_AHK)
        return false
    }

    try {
        wmi := ComObjGet("winmgmts:")
        query := "Select * from Win32_Process Where Name = 'AutoHotkey64.exe' Or Name = 'AutoHotkey32.exe' Or Name = 'AutoHotkey.exe'"

        for proc in wmi.ExecQuery(query) {
            cmd := ""
            try cmd := proc.CommandLine

            if (InStr(StrLower(cmd), "organizador.ahk")) {
                Log("Organizador já está aberto.")
                return true
            }
        }

        Run('"' A_AhkPath '" "' ORGANIZADOR_AHK '"', , "Hide")
        Log("OK: organizador iniciado: " ORGANIZADOR_AHK)
        Log("Organizador iniciado em modo invisível.")
        return true

    } catch as e {
        Log("ERRO ao iniciar organizador: " e.Message " | path=" ORGANIZADOR_AHK " | ahk=" A_AhkPath)
    }

    return false
}

; ===========================
; API (PowerShell)
; ===========================
Api_LoginAndGetToken() {
    global API_BASE, WHATSAPP, SENHA

    url := API_BASE "/auth/login"

    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "$body=@{ whatsapp='" PS_Escape(WHATSAPP) "'; senha='" PS_Escape(SENHA) "' } | ConvertTo-Json;" .
    "$r=Invoke-RestMethod -Method Post -Uri '" PS_Escape(url) "' -ContentType 'application/json' -Body $body;" .
    "if($null -eq $r.token){''} else { [string]$r.token }"
    )

    out := PS_Run(ps)
    out := Trim(out, "`r`n `t")
    if (!out) {
        Log("LOGIN sem token. (verifique /auth/login)")
        return ""
    }
    return out
}

Api_GetNovosIds(token) {
    global API_BASE, DEBUG_NOVOS_RAW

    url := API_BASE "/bot/pedidos/novos"

    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "$h=@{ Authorization='Bearer " PS_Escape(token) "' };" .
    "$r=Invoke-RestMethod -Method Get -Uri '" PS_Escape(url) "' -Headers $h;" .
    "function Emit($v){ if($null -ne $v){ [string]$v } };" .
    "function OutIds($x){" .
        "if($null -eq $x){ return }" .
        "if($x -is [System.Array]){" .
            "if($x.Count -eq 0){ return }" .
            "$first=$x[0];" .
            "if($first -is [string]){ $x | ForEach-Object { Emit $_ } }" .
            "elseif($first.PSObject.Properties.Match('id').Count -gt 0){ $x | ForEach-Object { if($_.PSObject.Properties.Match('status').Count -gt 0){ Emit ([string]$_.id + '|' + [string]$_.status) } else { Emit $_.id } } }" .
            "elseif($first.PSObject.Properties.Match('pedido_id').Count -gt 0){ $x | ForEach-Object { Emit $_.pedido_id } }" .
            "else{ $x | ForEach-Object { Emit $_ } }" .
        "} else {" .
            "if($x -is [string]){ Emit $x }" .
            "elseif($x.PSObject.Properties.Match('id').Count -gt 0){ if($x.PSObject.Properties.Match('status').Count -gt 0){ Emit ([string]$x.id + '|' + [string]$x.status) } else { Emit $x.id } }" .
            "elseif($x.PSObject.Properties.Match('pedido_id').Count -gt 0){ Emit $x.pedido_id }" .
            "elseif($x.PSObject.Properties.Match('ids').Count -gt 0){ OutIds $x.ids }" .
            "elseif($x.PSObject.Properties.Match('pedidos').Count -gt 0){ OutIds $x.pedidos }" .
            "elseif($x.PSObject.Properties.Match('novos').Count -gt 0){ OutIds $x.novos }" .
        "}" .
    "};" .
    "OutIds $r | ForEach-Object { $_ }"
    )

    out := PS_Run(ps)

    if (DEBUG_NOVOS_RAW) {
        rawOneLine := StrReplace(out, "`r", "")
        rawOneLine := StrReplace(rawOneLine, "`n", " | ")
        if (StrLen(rawOneLine) > 4000)
            rawOneLine := SubStr(rawOneLine, 1, 4000) "..."
        Log("NOVOS RAW: " rawOneLine)
    }

    lines := StrSplit(out, "`n", "`r")
    ids := []

    for _, line in lines {
        line := Trim(line)
        if (!line)
            continue
        if (StrLower(line) = "id")
            continue
        if RegExMatch(line, "^-+$")
            continue
        ids.Push(line)
    }

    return ids
}

Api_DownloadZip(token, id, savePath) {
    global API_BASE

    url := API_BASE "/bot/pedidos/" id "/zip"
    try FileDelete(savePath)

    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "$h=@{ Authorization='Bearer " PS_Escape(token) "' };" .
    "try{" .
        "Invoke-WebRequest -Uri '" PS_Escape(url) "' -Headers $h -OutFile '" PS_Escape(savePath) "' -UseBasicParsing | Out-Null;" .
        "} catch {" .
        "$code='';" .
        "try { $code = [int]$_.Exception.Response.StatusCode } catch { }" .
        "$msg = $_.Exception.Message;" .
        "Write-Output ('ERR|' + $code + '|' + $msg)" .
    "}"
    )

    out := Trim(PS_Run(ps), "`r`n `t")

    if (SubStr(out, 1, 4) = "ERR|") {
        Log("DOWNLOAD FAIL (" id "): " out)
        Log("URL: " url)
        return false
    }

    if !FileExist(savePath) {
        Log("DOWNLOAD FAIL (" id "): arquivo não encontrado após download")
        Log("URL: " url)
        return false
    }

    try fileSize := FileGetSize(savePath)
    catch
        fileSize := 0

    if (fileSize <= 0) {
        Log("DOWNLOAD FAIL (" id "): arquivo vazio")
        Log("URL: " url)
        return false
    }

    return true
}

Api_UpdateStatus(token, id, status) {
    global API_BASE

    url := API_BASE "/bot/pedidos/" id "/status"

    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "$h=@{ Authorization='Bearer " PS_Escape(token) "' };" .
    "$body=@{ status='" PS_Escape(status) "' } | ConvertTo-Json;" .
    "$r=Invoke-RestMethod -Method Post -Uri '" PS_Escape(url) "' -Headers $h -ContentType 'application/json' -Body $body;" .
    "'OK'"
    )

    out := Trim(PS_Run(ps), "`r`n `t")
    return (out = "OK")
}

BaixarSuporteFinalizado(token) {
    global API_BASE, SUPORTE_DIR

    url := API_BASE "/bot/suporte/finalizadas"

    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "$h=@{ Authorization='Bearer " PS_Escape(token) "' };" .
    "$r=Invoke-RestMethod -Method Get -Uri '" PS_Escape(url) "' -Headers $h;" .
    "if($null -eq $r.conversas -or $r.conversas.Count -eq 0){ 'SEM_SUPORTE' } else { $r | ConvertTo-Json -Depth 20 }"
    )

    out := Trim(PS_Run(ps), "`r`n `t")

    if (!out || out = "SEM_SUPORTE")
        return false

    DirCreate(SUPORTE_DIR)

    arquivo := SUPORTE_DIR "\suporte_" FormatTime(A_Now, "yyyyMMdd_HHmmss") ".json"

    try {
        FileAppend(out, arquivo, "UTF-8")
        Log("SUPORTE baixado: " arquivo)

        if (Api_LimparSuporteFinalizado(token)) {
            Log("SUPORTE limpo no servidor.")
        } else {
            Log("ATENÇÃO: suporte baixado, mas não limpou no servidor.")
        }

        return true
    } catch as e {
        Log("ERRO ao salvar suporte: " e.Message)
        return false
    }
}

Api_LimparSuporteFinalizado(token) {
    global API_BASE

    url := API_BASE "/bot/suporte/limpar-finalizadas"

    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "$h=@{ Authorization='Bearer " PS_Escape(token) "' };" .
    "$r=Invoke-RestMethod -Method Post -Uri '" PS_Escape(url) "' -Headers $h;" .
    "'OK'"
    )

    out := Trim(PS_Run(ps), "`r`n `t")
    return (out = "OK")
}

; ===========================
; ZIP EXTRACT
; ===========================
ExtractZip(zipPath, destDir) {
    ps :=
    (
    "$ErrorActionPreference='Stop';" .
    "Expand-Archive -Path '" PS_Escape(zipPath) "' -DestinationPath '" PS_Escape(destDir) "' -Force;" .
    "'OK'"
    )
    out := Trim(PS_Run(ps), "`r`n `t")
    return (out = "OK")
}

FindFileRecursiveByName(rootDir, targetName) {
    Loop Files, rootDir "\*", "FR" {
        if (StrLower(A_LoopFileName) = StrLower(targetName))
            return A_LoopFileFullPath
    }
    return ""
}

; ===========================
; REMBG LOCAL
; ===========================
ProcessOrderImages_Rembg(pedidoDir) {
    global REMBG_ENABLED, REMBG_PYTHON

    Log("REMBG pasta do pedido: " pedidoDir)

    if (!REMBG_ENABLED) {
        Log("REMBG desabilitado.")
        return
    }

    Log("REMBG checagem ignorada. Tentando executar direto com: " REMBG_PYTHON)

    encontrados := 0
    processados := 0

    Loop Files, pedidoDir "\*.*", "FR" {
        filePath := A_LoopFileFullPath
        Log("REMBG verificando arquivo: " filePath)

        if (!IsLikelyLogoFile(filePath))
            continue

        encontrados += 1

        outPath := BuildNoBgOutputPath(filePath)

        if (RemoveBackground_Rembg(filePath, outPath)) {
            try {
                if FileExist(filePath)
                    FileDelete(filePath)

                if FileExist(filePath) {
                    Log("REMBG ERRO: não conseguiu apagar original: " filePath)
                } else {
                    FileMove(outPath, filePath, 1)

                    if FileExist(filePath) {
                        Log("REMBG OK (substituído): " filePath)
                        processados += 1
                    } else {
                        Log("REMBG ERRO: moveu mas arquivo final não existe: " filePath)
                    }
                }
            } catch as e {
                Log("REMBG ERRO ao substituir original: " e.Message " | arquivo=" filePath)
            }
        } else {
            Log("REMBG FALHOU: " filePath)
        }
    }

    Log("REMBG finalizado | encontrados=" encontrados " | processados=" processados)
}

RembgIsAvailable() {
    global REMBG_PYTHON

    if !FileExist(REMBG_PYTHON)
        return false

    tempPy := A_Temp "\rembg_test_" A_TickCount ".py"

    py :=
    (
    "from rembg import remove`n"
    "from PIL import Image`n"
    "print('OK')`n"
    )

    try FileDelete(tempPy)
    FileAppend(py, tempPy, "UTF-8")

    ps :=
        "$ErrorActionPreference='SilentlyContinue';" .
        "$out = & '" PS_Escape(REMBG_PYTHON) "' '" PS_Escape(tempPy) "' 2>&1 | Out-String;" .
        "Write-Output $out;" .
        "Write-Output '<<EXITCODE>>' + $LASTEXITCODE;"

    out := PS_Run(ps)

    try FileDelete(tempPy)

    exitCode := 1
    if RegExMatch(out, "<<EXITCODE>>(\d+)", &m)
        exitCode := Integer(m[1])

    return (exitCode = 0)
}

IsLikelyLogoFile(filePath) {
    SplitPath(filePath, &outFileName, &outDir, &outExt, &outNameNoExt, &outDrive)
    name := StrLower(outFileName)

    return (
        name = "escudo1.png"
        || name = "escudo1.jpg"
        || name = "escudo1.jpeg"
        || name = "escudo1.webp"
        || name = "escudo1_sem_fundo.png"
        || name = "escudo2.png"
        || name = "escudo2.jpg"
        || name = "escudo2.jpeg"
        || name = "escudo2.webp"
        || name = "escudo2_sem_fundo.png"
        || name = "escudo_principal.png"
        || name = "escudo_principal.jpg"
        || name = "escudo_principal.jpeg"
        || name = "escudo_principal.webp"
        || name = "escudo_principal_sem_fundo.png"
        || name = "escudo_adversario.png"
        || name = "escudo_adversario.jpg"
        || name = "escudo_adversario.jpeg"
        || name = "escudo_adversario.webp"
        || name = "escudo_adversario_sem_fundo.png"
        || name = "logo.png"
        || name = "logo.jpg"
        || name = "logo.jpeg"
        || name = "logo.webp"
    )
}

BuildNoBgOutputPath(filePath) {
    SplitPath(filePath, &outFileName, &outDir, &outExt, &outNameNoExt, &outDrive)
    return outDir "\" outNameNoExt "_semfundo.png"
}

RemoveBackground_Rembg(imagePath, outputPath) {
    global REMBG_PYTHON

    if (!FileExist(imagePath)) {
        Log("REMBG arquivo não existe: " imagePath)
        return false
    }

    try FileDelete(outputPath)

    tempPy := A_Temp "\rembg_run_" A_TickCount ".py"

    py :=
    (
    "from rembg import remove`n"
    "from PIL import Image`n"
    "inp = r'" PS_Escape(imagePath) "'`n"
    "out = r'" PS_Escape(outputPath) "'`n"
    "i = Image.open(inp)`n"
    "o = remove(i)`n"
    "o.save(out)`n"
    "print('OK')`n"
    )

    Log("REMBG tempPy: " tempPy)
    Log("REMBG imagePath: " imagePath)
    Log("REMBG outputPath: " outputPath)

    try FileDelete(tempPy)
    FileAppend(py, tempPy, "UTF-8")

    Log("REMBG py content: " py)

    ps :=
        "$ErrorActionPreference='Stop';" .
        "try {" .
            "$out = & '" PS_Escape(REMBG_PYTHON) "' '" PS_Escape(tempPy) "' 2>&1 | Out-String;" .
            "Write-Output $out;" .
            "Write-Output ('<<EXITCODE>>' + $LASTEXITCODE);" .
        "} catch {" .
            "Write-Output ('ERR|' + $_.Exception.Message);" .
            "Write-Output '<<EXITCODE>>1';" .
        "}"

    out := PS_Run(ps)

    try FileDelete(tempPy)

    if InStr(out, "ERR|") {
        Log("REMBG ERRO: " StrReplace(Trim(out), "`r`n", " | "))
        return false
    }

    exitCode := 1
    if RegExMatch(out, "<<EXITCODE>>(\d+)", &m)
        exitCode := Integer(m[1])

    cleanedOut := StrReplace(out, "`r", "")
    cleanedOut := StrReplace(cleanedOut, "`n", " | ")
    cleanedOut := Trim(cleanedOut, " |")

    if (exitCode != 0) {
        Log("REMBG CLI retornou código " exitCode ": " cleanedOut)
        return false
    }

    if !FileExist(outputPath) {
        Log("REMBG FAIL: arquivo não criado")
        return false
    }

    try size := FileGetSize(outputPath)
    catch
        size := 0

    if (size <= 0) {
        Log("REMBG FAIL: arquivo vazio")
        return false
    }

    return true
}

; ===========================
; POWERSHELL EXEC
; ===========================
PS_Run(psCommand) {
    tempOut := A_Temp "\omascote_ps_out_" A_TickCount ".txt"
    tempErr := A_Temp "\omascote_ps_err_" A_TickCount ".txt"
    tempPs1 := A_Temp "\omascote_ps_cmd_" A_TickCount ".ps1"

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

    if (stderr && Trim(stderr)) {
        Log("PS STDERR: " Trim(stderr))
    }

    return stdout
}

PS_Escape(s) {
    return StrReplace(s, "'", "''")
}

; ===========================
; PROCESSED + LOG
; ===========================
Log(msg) {
    global LOG_FILE
    ts := FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss")
    FileAppend(ts " | " msg "`n", LOG_FILE, "UTF-8")
}

LoadProcessed() {
    global PROCESSED_FILE, g_processed
    if (!FileExist(PROCESSED_FILE))
        return
    txt := FileRead(PROCESSED_FILE, "UTF-8")
    for _, line in StrSplit(txt, "`n", "`r") {
        line := Trim(line)
        if (line)
            g_processed[line] := true
    }
}

IsProcessedOnDisk(id) {
    global PROCESSED_FILE
    if (!FileExist(PROCESSED_FILE))
        return false
    txt := "`n" FileRead(PROCESSED_FILE, "UTF-8") "`n"
    return InStr(txt, "`n" id "`n") > 0
}

AppendProcessed(id) {
    global PROCESSED_FILE
    FileAppend(id "`n", PROCESSED_FILE, "UTF-8")
}













