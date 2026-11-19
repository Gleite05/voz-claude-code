// VozBarra — anfitrião Windows da barra «Voz» para o Claude Code.
// Uma janela fina (WebView2) encaixada no ecrã como a barra de tarefas (AppBar), com o
// desfoque acrílico do Windows 11, e uma segunda janela para os menus.
// Escrito em C# 5 para compilar com o csc.exe que já vem com o .NET Framework 4.8.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace VozBarra
{
    static class Programa
    {
        public static readonly string Pasta = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VOZ_DIR"))
            ? Environment.GetEnvironmentVariable("VOZ_DIR")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "voz");
        public static readonly string PastaBarra = Path.Combine(Pasta, "barra");
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        /// Sem vidro: fundo opaco (para Windows sem acrílico, ou se o vidro der problemas).
        public static readonly bool SemVidro = Environment.GetEnvironmentVariable("VOZ_SEM_VIDRO") == "1" || File.Exists(Path.Combine(PastaBarra, "sem-vidro"));

        const string NomeMostrar = "Local\\VozBarra-ClaudeCode-Mostrar";

        [STAThread]
        static void Main()
        {
            bool novo;
            using (var mutex = new Mutex(true, "Local\\VozBarra-ClaudeCode", out novo))
            {
                if (!novo)
                {
                    // Já há uma barra (talvez escondida na área de notificação): pede-lhe que se mostre.
                    try { EventWaitHandle.OpenExisting(NomeMostrar).Set(); } catch { }
                    return;
                }
                try { Nativo.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Registo.Escrever("arranque");
                var dados = DadosBarra.Ler();
                if (dados == null) { Registo.Escrever("sem barra.json — corre /voz:barra instalar"); return; }
                if (!Servidor.Garantir(dados)) { Registo.Escrever("o servidor da voz não arrancou"); }
                var barra = new Barra(dados);
                var mostrar = new EventWaitHandle(false, EventResetMode.AutoReset, NomeMostrar);
                var vigia = new Thread(delegate()
                {
                    while (mostrar.WaitOne())
                        try { barra.BeginInvoke((Action)barra.Mostrar); } catch { }
                });
                vigia.IsBackground = true;
                vigia.Start();
                Application.Run(barra);
            }
        }
    }

    static class Registo
    {
        public static void Escrever(string texto)
        {
            try
            {
                Directory.CreateDirectory(Programa.PastaBarra);
                var f = Path.Combine(Programa.PastaBarra, "barra.log");
                if (File.Exists(f) && new FileInfo(f).Length > 200 * 1024) File.Delete(f);
                File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + texto + Environment.NewLine);
            }
            catch { }
        }
    }

    class DadosBarra
    {
        public int Porta;
        public string Token;
        public string Node;
        public string Servidor;

        public string Url(string vista)
        {
            return "http://127.0.0.1:" + Porta + "/?vista=" + vista + (Programa.SemVidro ? "&vidro=0" : "") + "&t=" + Uri.EscapeDataString(Token);
        }

        public static DadosBarra Ler()
        {
            try
            {
                var d = Programa.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(Programa.PastaBarra, "barra.json")));
                var r = new DadosBarra();
                r.Porta = Convert.ToInt32(d["porta"]);
                r.Token = Convert.ToString(d["token"]);
                r.Node = Convert.ToString(d["node"]);
                r.Servidor = Convert.ToString(d["servidor"]);
                return r;
            }
            catch (Exception e) { Registo.Escrever("barra.json: " + e.Message); return null; }
        }

        /// Lê a posição gravada em config.json (a interface também a envia depois de arrancar).
        public static string PosicaoGuardada()
        {
            try
            {
                var d = Programa.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(Programa.Pasta, "config.json")));
                object v;
                if (d.TryGetValue("barraPosicao", out v) && v != null) return Convert.ToString(v);
            }
            catch { }
            return "topo";
        }
    }

    static class Servidor
    {
        static bool Responde(int porta)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + porta + "/saude");
                req.Timeout = 700;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        /// Garante que o servidor da voz está a correr (arranca-o com o node, escondido).
        public static bool Garantir(DadosBarra d)
        {
            if (Responde(d.Porta)) return true;
            try
            {
                var psi = new ProcessStartInfo(d.Node, "\"" + d.Servidor + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
                Registo.Escrever("servidor lançado: " + d.Servidor);
            }
            catch (Exception e) { Registo.Escrever("lançar servidor: " + e.Message); return false; }
            for (int i = 0; i < 40; i++)
            {
                Thread.Sleep(200);
                if (Responde(d.Porta)) return true;
            }
            return false;
        }
    }

    // ------------------------------------------------------------------ janelas com WebView2

    class JanelaWeb : Form
    {
        protected WebView2 Web;
        protected readonly DadosBarra Dados;
        public bool Pronta;
        bool redonda;

        public JanelaWeb(DadosBarra dados, bool cantosRedondos)
        {
            Dados = dados;
            redonda = cantosRedondos;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.Black;
            Web = new WebView2();
            Web.DefaultBackgroundColor = Programa.SemVidro ? Color.FromArgb(255, 30, 30, 34) : Color.Transparent;
            Web.Dock = DockStyle.Fill;
            Controls.Add(Web);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x80; // WS_EX_TOOLWINDOW: fora do Alt+Tab
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (Programa.SemVidro) { Nativo.CantosRedondos(Handle, redonda); Nativo.ModoEscuro(Handle, true); }
            else Nativo.AplicarVidro(Handle, redonda);
        }

        // Sem botão na barra de tarefas, uma janela minimizada (Win+M, «mostrar o ambiente de trabalho»…)
        // ficava perdida: estas nunca ficam minimizadas.
        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (WindowState == FormWindowState.Minimized)
                BeginInvoke((Action)delegate { WindowState = FormWindowState.Normal; AoRestaurar(); });
        }

        protected virtual void AoRestaurar() { }

        public double Escala
        {
            get { try { return Nativo.GetDpiForWindow(Handle) / 96.0; } catch { return 1.0; } }
        }

        public void TemaEscuro(bool escuro)
        {
            Nativo.ModoEscuro(Handle, escuro);
            if (!Programa.SemVidro) Nativo.Acrilico(Handle, escuro); // a tinta do vidro acompanha o tema
        }

        protected async void Iniciar(string url)
        {
            try
            {
                var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Programa.PastaBarra, "webview-dados"));
                await Web.EnsureCoreWebView2Async(env);
                var s = Web.CoreWebView2.Settings;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.IsZoomControlEnabled = false;
                s.AreBrowserAcceleratorKeysEnabled = false;
                s.AreDevToolsEnabled = File.Exists(Path.Combine(Programa.PastaBarra, "depurar"));
                Web.CoreWebView2.WebMessageReceived += delegate(object o, CoreWebView2WebMessageReceivedEventArgs a)
                {
                    Dictionary<string, object> msg = null;
                    try { msg = Programa.Json.Deserialize<Dictionary<string, object>>(a.WebMessageAsJson); } catch { }
                    if (msg != null) AoReceber(msg);
                };
                Web.CoreWebView2.NavigationCompleted += delegate { Pronta = true; AoCarregar(); };
                Web.CoreWebView2.Navigate(url);
            }
            catch (Exception e) { Registo.Escrever("WebView2: " + e.Message); }
        }

        public void Enviar(object msg)
        {
            if (Web == null || Web.CoreWebView2 == null) return;
            try { Web.CoreWebView2.PostWebMessageAsJson(Programa.Json.Serialize(msg)); } catch { }
        }

        public void Recarregar()
        {
            if (Web != null && Web.CoreWebView2 != null) Web.CoreWebView2.Reload();
        }

        protected virtual void AoReceber(Dictionary<string, object> msg) { }
        protected virtual void AoCarregar() { }

        protected static string Texto(Dictionary<string, object> m, string k)
        {
            object v;
            return m.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
        }

        protected static double Numero(Dictionary<string, object> m, string k)
        {
            object v;
            if (!m.TryGetValue(k, out v) || v == null) return 0;
            try { return Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture); } catch { return 0; }
        }
    }

    // ------------------------------------------------------------------ menus

    class Menu : JanelaWeb
    {
        readonly Barra barra;
        public string Atual = "";
        public bool Aberto; // a janela fica sempre «visível», mas estacionada fora do ecrã quando fechada
        public DateTime EscondidoEm = DateTime.MinValue;
        Rectangle ancora;
        bool aEsperarTamanho;
        string pendente;

        public Menu(DadosBarra dados, Barra dona) : base(dados, true)
        {
            barra = dona;
            Size = new Size(10, 10);
            Location = new Point(-32000, -32000);
            Deactivate += delegate { Esconder(); };
            Iniciar(dados.Url("menu"));
        }

        protected override bool ShowWithoutActivation { get { return false; } }

        bool ativar = true;
        bool centrar; // cartão centrado por baixo (ou por cima) da âncora: a ilha da barra

        public void Abrir(string menu, Rectangle ancoraEcra, bool ativarJanela, bool centrado)
        {
            Atual = menu;
            ancora = ancoraEcra;
            ativar = ativarJanela;
            centrar = centrado;
            aEsperarTamanho = true;
            if (!Pronta) { pendente = menu; return; }
            Enviar(new Dictionary<string, object> { { "tipo", "menu" }, { "menu", menu } });
        }

        protected override void AoCarregar()
        {
            Enviar(barra.ListaEcras());
            if (pendente == null) return;
            var m = pendente;
            pendente = null;
            Enviar(new Dictionary<string, object> { { "tipo", "menu" }, { "menu", m } });
        }

        protected override void AoRestaurar()
        {
            if (!Aberto) Estacionar();
        }

        public void Estacionar()
        {
            Location = new Point(-32000, -32000);
        }

        public void Esconder()
        {
            if (!Aberto) return;
            Aberto = false;
            Estacionar();
            EscondidoEm = DateTime.Now;
            barra.MenuFechou();
        }

        protected override void AoReceber(Dictionary<string, object> msg)
        {
            var tipo = Texto(msg, "tipo");
            if (tipo == "tamanho")
            {
                // Só abre quando foi pedido; aberto, acompanha mudanças de tamanho; escondido, ignora.
                if (!aEsperarTamanho && !Aberto) return;
                aEsperarTamanho = false;
                var e = Escala;
                var w = (int)Math.Ceiling(Numero(msg, "w") * e);
                var h = (int)Math.Ceiling(Numero(msg, "h") * e);
                Posicionar(w, h);
            }
            else if (tipo == "fechar-menu") Esconder();
            else if (tipo == "sair") barra.Sair();
            else if (tipo == "esconder") { Esconder(); barra.Esconder(); }
        }

        void Posicionar(int w, int h)
        {
            var area = Screen.FromRectangle(ancora).WorkingArea;
            var ecra = Screen.FromRectangle(ancora).Bounds;
            int x, y;
            int folga = (int)(4 * Escala);
            bool aviso = Barra.EAviso(Atual);
            switch (barra.Posicao)
            {
                case "fundo": x = aviso ? ancora.Right - w - folga : ancora.Left; y = ancora.Top - h - folga; break;
                case "esquerda": x = ancora.Right + folga; y = ancora.Top + (aviso ? folga : 0); break;
                case "direita": x = ancora.Left - w - folga; y = ancora.Top + (aviso ? folga : 0); break;
                default: x = aviso ? ancora.Right - w - folga : ancora.Left; y = ancora.Bottom + folga; break;
            }
            if (centrar && (barra.Posicao == "topo" || barra.Posicao == "escondida" || barra.Posicao == "fundo" || barra.Posicao == "flutuante"))
                x = ancora.Left + (ancora.Width - w) / 2;
            x = Math.Max(ecra.Left + folga, Math.Min(x, ecra.Right - w - folga));
            y = Math.Max(ecra.Top + folga, Math.Min(y, ecra.Bottom - h - folga));
            SetBounds(x, y, w, h);
            Aberto = true;
            if (ativar) Activate(); // o aviso aparece sem tirar o foco a quem está a escrever
        }
    }

    // ------------------------------------------------------------------ barra

    class Barra : JanelaWeb
    {
        public string Posicao = "topo";
        readonly Menu menu;
        readonly uint mensagemAppBar;
        // O Explorer avisa com "TaskbarCreated" quando reinicia — e nessa altura esquece todas as AppBars.
        readonly uint mensagemBarraCriada;
        DateTime reservaReparadaEm = DateTime.MinValue;
        bool appBarRegistada;
        // Ecrã inteiro: quando uma janela (RDP, vídeo, jogo, apresentação…) ocupa o monitor da barra,
        // a barra recolhe-se para trás dela e volta quando essa janela sai do ecrã inteiro.
        readonly System.Windows.Forms.Timer vigiaEcraInteiro = new System.Windows.Forms.Timer();
        IntPtr janelaEcraInteiro = IntPtr.Zero;
        bool recolhida;
        int larguraFlutuante = 520;
        readonly System.Windows.Forms.Timer relogio = new System.Windows.Forms.Timer();
        // Sensor do ambiente: ausência (rato/teclado parados), microfone ocupado e ecrã inteiro.
        readonly System.Windows.Forms.Timer sensor = new System.Windows.Forms.Timer();
        bool ausente;
        DateTime ausenteDesde;
        string ambienteEnviado = "";
        DateTime ambienteEm = DateTime.MinValue;
        const uint AUSENTE_MS = 5 * 60 * 1000;
        bool escondidaVisivel = true;
        DateTime ratoSaiuEm = DateTime.MinValue;
        DateTime mostrarAte = DateTime.MinValue;
        bool aSair;
        // Ícone na área de notificação: está sempre lá e é por onde se volta a abrir a barra escondida.
        readonly NotifyIcon bandeja = new NotifyIcon();
        readonly ContextMenuStrip menuBandeja = new ContextMenuStrip();
        readonly ToolStripMenuItem opMostrar, opSilencio, opSair;
        public bool NaBandeja;
        bool avisouBandeja;
        Dictionary<string, object> textos = new Dictionary<string, object>
        {
            { "mostrar", "Mostrar a barra" }, { "esconder", "Esconder a barra" }, { "silencio", "Não incomodar" },
            { "sair", "Sair da barra" }, { "dica", "Voz · clica para mostrar ou esconder a barra" },
            { "aviso", "A barra está escondida aqui. Clica no ícone para a voltar a mostrar." }
        };

        public Barra(DadosBarra dados) : base(dados, false)
        {
            opMostrar = new ToolStripMenuItem("", null, delegate { AlternarBandeja(); });
            opMostrar.Font = new Font(opMostrar.Font, FontStyle.Bold);
            opSilencio = new ToolStripMenuItem("", null, delegate { Enviar(new Dictionary<string, object> { { "tipo", "atalho" }, { "qual", "silencio" } }); });
            opSair = new ToolStripMenuItem("", null, delegate { Sair(); });
            menuBandeja.Items.AddRange(new ToolStripItem[] { opMostrar, opSilencio, new ToolStripSeparator(), opSair });
            menuBandeja.Opening += delegate { AtualizarBandeja(); };
            bandeja.ContextMenuStrip = menuBandeja;
            bandeja.MouseClick += delegate(object o, MouseEventArgs a) { if (a.Button == MouseButtons.Left) AlternarBandeja(); };
            AtualizarBandeja();
            mensagemAppBar = Nativo.RegisterWindowMessage("VozBarraAppBar");
            mensagemBarraCriada = Nativo.RegisterWindowMessage("TaskbarCreated");
            Posicao = DadosBarra.PosicaoGuardada();
            Text = "Voz";
            menu = new Menu(dados, this);
            relogio.Interval = 120;
            relogio.Tick += delegate { Vigiar(); };
            sensor.Interval = 2000;
            sensor.Tick += delegate { Sentir(); };
            vigiaEcraInteiro.Interval = 300;
            vigiaEcraInteiro.Tick += delegate { VigiarEcraInteiro(); };
            Iniciar(dados.Url("barra"));
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            menu.Show(); // carrega a página do menu já, estacionada fora do ecrã
            menu.Estacionar();
            AplicarPosicao(Posicao);
            RegistarAtalhos();
            relogio.Start();
            sensor.Start();
            vigiaEcraInteiro.Start();
            bandeja.Icon = Nativo.IconeVoz((int)Math.Round(16 * Escala));
            bandeja.Visible = true;
        }

        string T(string k) { object v; return textos.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : k; }

        void AtualizarBandeja()
        {
            opMostrar.Text = T(NaBandeja ? "mostrar" : "esconder");
            opSilencio.Text = T("silencio");
            opSair.Text = T("sair");
            var dica = T("dica");
            bandeja.Text = dica.Length > 63 ? dica.Substring(0, 63) : dica;
        }

        void AlternarBandeja()
        {
            if (NaBandeja) Mostrar(); else Esconder();
        }

        /// «Fechar» a barra: sai do ecrã mas fica na área de notificação (a voz e os atalhos continuam).
        public void Esconder()
        {
            if (NaBandeja || aSair) return;
            NaBandeja = true;
            menu.Esconder();
            RemoverAppBar();
            Hide();
            AtualizarBandeja();
            Registo.Escrever("barra escondida na área de notificação");
            if (!avisouBandeja)
            {
                avisouBandeja = true;
                try { bandeja.ShowBalloonTip(5000, "Voz", T("aviso"), ToolTipIcon.None); } catch { }
            }
        }

        protected override void AoRestaurar()
        {
            if (!NaBandeja) AplicarPosicao(Posicao);
        }

        public void Mostrar()
        {
            if (aSair) return;
            if (!NaBandeja)
            {
                if (Posicao == "escondida") mostrarAte = DateTime.Now.AddSeconds(3);
                AplicarPosicao(Posicao); // volta ao sítio e para cima de tudo
                return;
            }
            NaBandeja = false;
            Show();
            AplicarPosicao(Posicao);
            AtualizarBandeja();
        }

        int Espessura(bool vertical)
        {
            return (int)Math.Round((vertical ? 40 : 30) * Escala);
        }

        int ecraEscolhido = -1; // -1 = principal

        Rectangle Ecra
        {
            get
            {
                var todos = Screen.AllScreens;
                if (ecraEscolhido >= 0 && ecraEscolhido < todos.Length) return todos[ecraEscolhido].Bounds;
                return Screen.PrimaryScreen.Bounds;
            }
        }

        /// Lista de monitores para o menu (largura, altura, principal).
        public object ListaEcras()
        {
            var l = new List<object>();
            foreach (var s in Screen.AllScreens)
                l.Add(new Dictionary<string, object> { { "largura", s.Bounds.Width }, { "altura", s.Bounds.Height }, { "principal", s.Primary } });
            return new Dictionary<string, object> { { "tipo", "ecras" }, { "lista", l } };
        }

        // ---------- atalhos globais (Ctrl+Shift+Alt + tecla) ----------
        static readonly string[] Atalhos = { "falar", "pausa", "saltar", "conversas", "silencio" };
        static readonly Keys[] TeclasAtalhos = { Keys.V, Keys.P, Keys.N, Keys.C, Keys.D };

        void RegistarAtalhos()
        {
            for (int i = 0; i < Atalhos.Length; i++)
            {
                // MOD_ALT 1 | MOD_CONTROL 2 | MOD_SHIFT 4 | MOD_NOREPEAT 0x4000
                if (!Nativo.RegisterHotKey(Handle, 100 + i, 0x1 | 0x2 | 0x4 | 0x4000, (uint)TeclasAtalhos[i]))
                    Registo.Escrever("atalho ocupado: Ctrl+Shift+Alt+" + TeclasAtalhos[i]);
            }
        }

        void RemoverAtalhos()
        {
            for (int i = 0; i < Atalhos.Length; i++) Nativo.UnregisterHotKey(Handle, 100 + i);
        }

        public void AplicarPosicao(string p)
        {
            Posicao = p;
            menu.Esconder();
            if (p == "topo" || p == "fundo" || p == "esquerda" || p == "direita")
            {
                Nativo.CantosRedondos(Handle, false);
                RegistarAppBar(p);
            }
            else
            {
                RemoverAppBar();
                if (p == "flutuante")
                {
                    Nativo.CantosRedondos(Handle, true);
                    var pos = LerPosicaoFlutuante();
                    var h = (int)Math.Round(34 * Escala);
                    SetBounds(pos.X, pos.Y, larguraFlutuante, h);
                }
                else
                {
                    Nativo.CantosRedondos(Handle, false);
                    escondidaVisivel = true;
                    mostrarAte = DateTime.Now.AddSeconds(2);
                    SetBounds(Ecra.Left, Ecra.Top, Ecra.Width, Espessura(false));
                }
            }
            if (!recolhida) TopMost = true;
        }

        // ---------- ecrã inteiro ----------
        void VigiarEcraInteiro()
        {
            if (NaBandeja) { if (recolhida) Voltar(); return; }
            var monitor = Nativo.MonitorDe(Handle);
            var fg = Nativo.GetForegroundWindow();
            if (fg != IntPtr.Zero && Nativo.MonitorDe(fg) == monitor && Nativo.EmEcraInteiro(fg))
            {
                janelaEcraInteiro = fg;
                if (!recolhida) Recolher();
                return;
            }
            if (!recolhida) return;
            // Continua escondida enquanto a janela em ecrã inteiro existir e estiveres a usar outro monitor
            // (ex.: o RDP em ecrã inteiro no principal e o rato noutro ecrã).
            bool aindaCheia = Nativo.IsWindow(janelaEcraInteiro) && Nativo.MonitorDe(janelaEcraInteiro) == monitor && Nativo.EmEcraInteiro(janelaEcraInteiro);
            bool focoNoutroMonitor = fg == IntPtr.Zero || Nativo.MonitorDe(fg) != monitor;
            if (!(aindaCheia && focoNoutroMonitor)) Voltar();
        }

        void Recolher()
        {
            recolhida = true;
            menu.Esconder();
            TopMost = false;
            Nativo.ParaTras(Handle);
            Registo.Escrever("ecrã inteiro no monitor da barra: a barra recolhe-se");
        }

        void Voltar()
        {
            recolhida = false;
            janelaEcraInteiro = IntPtr.Zero;
            TopMost = true;
            Registo.Escrever("fim do ecrã inteiro: a barra volta");
        }

        // ---------- AppBar ----------
        void RegistarAppBar(string p)
        {
            var abd = NovoAbd();
            if (!appBarRegistada)
            {
                abd.uCallbackMessage = mensagemAppBar;
                Nativo.SHAppBarMessage(Nativo.ABM_NEW, ref abd);
                appBarRegistada = true;
            }
            PosicionarAppBar(p);
        }

        void PosicionarAppBar(string p)
        {
            var abd = NovoAbd();
            var e = Ecra;
            bool vertical = p == "esquerda" || p == "direita";
            int esp = Espessura(vertical);
            abd.uEdge = p == "fundo" ? Nativo.ABE_BOTTOM : p == "esquerda" ? Nativo.ABE_LEFT : p == "direita" ? Nativo.ABE_RIGHT : Nativo.ABE_TOP;
            abd.rc.left = e.Left; abd.rc.top = e.Top; abd.rc.right = e.Right; abd.rc.bottom = e.Bottom;
            if (p == "topo") abd.rc.bottom = e.Top + esp;
            else if (p == "fundo") abd.rc.top = e.Bottom - esp;
            else if (p == "esquerda") abd.rc.right = e.Left + esp;
            else abd.rc.left = e.Right - esp;
            Nativo.SHAppBarMessage(Nativo.ABM_QUERYPOS, ref abd);
            if (p == "topo") abd.rc.bottom = abd.rc.top + esp;
            else if (p == "fundo") abd.rc.top = abd.rc.bottom - esp;
            else if (p == "esquerda") abd.rc.right = abd.rc.left + esp;
            else abd.rc.left = abd.rc.right - esp;
            Nativo.SHAppBarMessage(Nativo.ABM_SETPOS, ref abd);
            SetBounds(abd.rc.left, abd.rc.top, abd.rc.right - abd.rc.left, abd.rc.bottom - abd.rc.top);
        }

        bool Encaixada { get { return Posicao == "topo" || Posicao == "fundo" || Posicao == "esquerda" || Posicao == "direita"; } }

        /// A barra encaixada tem de empurrar as janelas: se a área de trabalho do monitor deixou de a
        /// excluir (o Explorer reiniciou, outra barra mexeu na área de trabalho…), volta a reservar o lugar.
        void VerificarReserva()
        {
            if (!appBarRegistada || !Encaixada || !Visible || NaBandeja) return;
            var w = Nativo.AreaDeTrabalho(Handle);
            var b = Bounds;
            bool ok = Posicao == "topo" ? w.top >= b.Bottom
                : Posicao == "fundo" ? w.bottom <= b.Top
                : Posicao == "esquerda" ? w.left >= b.Right
                : w.right <= b.Left;
            if (ok || (DateTime.Now - reservaReparadaEm).TotalSeconds < 15) return;
            reservaReparadaEm = DateTime.Now;
            Registo.Escrever("a reserva da barra perdeu-se (área de trabalho " + w.left + "," + w.top + "-" + w.right + "," + w.bottom + "); a registar de novo");
            RemoverAppBar();
            RegistarAppBar(Posicao);
        }

        void RemoverAppBar()
        {
            if (!appBarRegistada) return;
            var abd = NovoAbd();
            Nativo.SHAppBarMessage(Nativo.ABM_REMOVE, ref abd);
            appBarRegistada = false;
        }

        Nativo.APPBARDATA NovoAbd()
        {
            var abd = new Nativo.APPBARDATA();
            abd.cbSize = Marshal.SizeOf(typeof(Nativo.APPBARDATA));
            abd.hWnd = Handle;
            return abd;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x0312) // WM_HOTKEY
            {
                int i = m.WParam.ToInt32() - 100;
                if (i >= 0 && i < Atalhos.Length)
                {
                    if (Posicao == "escondida") mostrarAte = DateTime.Now.AddSeconds(4);
                    Enviar(new Dictionary<string, object> { { "tipo", "atalho" }, { "qual", Atalhos[i] } });
                }
            }
            else if (mensagemBarraCriada != 0 && m.Msg == (int)mensagemBarraCriada)
            {
                // O Explorer reiniciou e esqueceu a reserva: regista-se de novo, como faz a barra de tarefas.
                appBarRegistada = false;
                if (Encaixada && Visible && !NaBandeja)
                    BeginInvoke((Action)delegate { Registo.Escrever("Explorer reiniciado: a reservar o lugar da barra de novo"); RegistarAppBar(Posicao); });
            }
            else if (appBarRegistada && m.Msg == (int)mensagemAppBar)
            {
                int aviso = m.WParam.ToInt32();
                if (aviso == Nativo.ABN_POSCHANGED) PosicionarAppBar(Posicao);
                else if (aviso == Nativo.ABN_FULLSCREENAPP && m.LParam == IntPtr.Zero && !recolhida) TopMost = true;
            }
            else if (m.Msg == 0x0006 && appBarRegistada) // WM_ACTIVATE
            {
                var abd = NovoAbd();
                Nativo.SHAppBarMessage(Nativo.ABM_ACTIVATE, ref abd);
            }
            else if (m.Msg == 0x0047 && appBarRegistada) // WM_WINDOWPOSCHANGED
            {
                var abd = NovoAbd();
                Nativo.SHAppBarMessage(Nativo.ABM_WINDOWPOSCHANGED, ref abd);
            }
            else if (m.Msg == 0x007E && appBarRegistada) // WM_DISPLAYCHANGE
            {
                BeginInvoke((Action)delegate { PosicionarAppBar(Posicao); });
            }
            base.WndProc(ref m);
        }

        // ---------- ambiente ----------
        /// Diz à página (que diz ao servidor) quando voltas ao computador e quando estás numa reunião
        /// ou apresentação, para a voz se calar sozinha e resumir o que aconteceu enquanto estavas fora.
        void Sentir()
        {
            VerificarReserva();
            uint parado = Nativo.TempoParadoMs();
            if (!ausente && parado >= AUSENTE_MS)
            {
                ausente = true;
                ausenteDesde = DateTime.UtcNow.AddMilliseconds(-(double)parado);
            }
            else if (ausente && parado < 4000)
            {
                ausente = false;
                var desde = (long)(ausenteDesde - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
                Enviar(new Dictionary<string, object> { { "tipo", "regresso" }, { "desde", desde } });
            }
            string app = Nativo.MicrofoneEmUso();
            int n = Nativo.EstadoNotificacoes();
            bool ecraInteiro = n == 2 || n == 3 || n == 4; // QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE
            string chave = (app ?? "") + "|" + ecraInteiro;
            if (chave != ambienteEnviado || (DateTime.Now - ambienteEm).TotalSeconds >= 10)
            {
                ambienteEnviado = chave;
                ambienteEm = DateTime.Now;
                Enviar(new Dictionary<string, object> { { "tipo", "ambiente" }, { "micro", app != null }, { "app", app ?? "" }, { "ecraInteiro", ecraInteiro } });
            }
        }

        // ---------- escondida / flutuante ----------
        void Vigiar()
        {
            if (Posicao != "escondida" || NaBandeja) return;
            var rato = Cursor.Position;
            var e = Ecra;
            bool sobre = Bounds.Contains(rato) || (rato.Y <= e.Top + 1 && rato.X >= e.Left && rato.X < e.Right);
            if (sobre || menu.Aberto || DateTime.Now < mostrarAte)
            {
                ratoSaiuEm = DateTime.MinValue;
                if (!escondidaVisivel) { escondidaVisivel = true; Top = e.Top; }
                return;
            }
            if (ratoSaiuEm == DateTime.MinValue) ratoSaiuEm = DateTime.Now;
            if (escondidaVisivel && (DateTime.Now - ratoSaiuEm).TotalMilliseconds > 700)
            {
                escondidaVisivel = false;
                Top = e.Top - Height + 1; // deixa uma linha de 1 px para o rato a «acordar»
            }
        }

        string FicheiroJanela { get { return Path.Combine(Programa.PastaBarra, "janela.json"); } }

        Point LerPosicaoFlutuante()
        {
            try
            {
                var d = Programa.Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(FicheiroJanela));
                var p = new Point(Convert.ToInt32(d["x"]), Convert.ToInt32(d["y"]));
                foreach (var s in Screen.AllScreens) if (s.WorkingArea.Contains(p)) return p;
            }
            catch { }
            return new Point(Ecra.Left + (Ecra.Width - larguraFlutuante) / 2, Ecra.Top + (int)(12 * Escala));
        }

        void GuardarPosicaoFlutuante()
        {
            try { File.WriteAllText(FicheiroJanela, Programa.Json.Serialize(new Dictionary<string, object> { { "x", Left }, { "y", Top } })); } catch { }
        }

        protected override void OnResizeEnd(EventArgs e)
        {
            base.OnResizeEnd(e);
            if (Posicao == "flutuante") GuardarPosicaoFlutuante();
        }

        // ---------- mensagens da interface ----------
        protected override void AoReceber(Dictionary<string, object> msg)
        {
            var tipo = Texto(msg, "tipo");
            switch (tipo)
            {
                case "posicao":
                    var p = Texto(msg, "valor");
                    if (p != "" && p != Posicao) AplicarPosicao(p);
                    break;
                case "ecra":
                    int ec = (int)Numero(msg, "valor");
                    if (ec != ecraEscolhido) { ecraEscolhido = ec; RemoverAppBar(); AplicarPosicao(Posicao); }
                    break;
                case "abrir":
                    object at;
                    bool ativar = !(msg.TryGetValue("ativar", out at) && at is bool && !(bool)at);
                    object ce;
                    bool centrado = msg.TryGetValue("centrar", out ce) && ce is bool && (bool)ce;
                    AbrirMenu(Texto(msg, "menu"), Numero(msg, "x"), Numero(msg, "y"), Numero(msg, "w"), Numero(msg, "h"), ativar, centrado);
                    break;
                case "largura":
                    if (Posicao == "flutuante")
                    {
                        larguraFlutuante = Math.Max(160, (int)Math.Ceiling(Numero(msg, "w") * Escala));
                        Width = larguraFlutuante;
                    }
                    break;
                case "arrastar":
                    if (Posicao == "flutuante")
                    {
                        Nativo.ReleaseCapture();
                        Nativo.SendMessage(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); // WM_NCLBUTTONDOWN, HTCAPTION
                        GuardarPosicaoFlutuante();
                    }
                    break;
                case "tema":
                    var escuro = Texto(msg, "escuro").ToLowerInvariant() == "true";
                    TemaEscuro(escuro);
                    menu.TemaEscuro(escuro);
                    break;
                case "atencao":
                    mostrarAte = DateTime.Now.AddSeconds(6);
                    break;
                case "servidor-em-baixo":
                    Task.Run(delegate { Servidor.Garantir(Dados); });
                    break;
                case "sair":
                    Sair();
                    break;
                case "esconder":
                    Esconder();
                    break;
                case "bandeja":
                    object tx;
                    if (msg.TryGetValue("textos", out tx) && tx is Dictionary<string, object>) textos = (Dictionary<string, object>)tx;
                    object sil;
                    opSilencio.Checked = msg.TryGetValue("silencio", out sil) && sil is bool && (bool)sil;
                    AtualizarBandeja();
                    break;
            }
        }

        /// Cartões que aparecem sozinhos no canto (aviso de conversa, pedido de autorização, ditado).
        public static bool EAviso(string m)
        {
            return m.StartsWith("aviso:") || m.StartsWith("perm:") || m.StartsWith("ditado:");
        }

        void AbrirMenu(string qual, double x, double y, double w, double h, bool ativar, bool centrado)
        {
            bool aviso = EAviso(qual);
            // Escondida na área de notificação: nada salta para o ecrã (o ditado, pedido por atalho, sim).
            if (NaBandeja && !qual.StartsWith("ditado:")) return;
            // Um aviso nunca tapa um menu que abriste à mão.
            if (aviso && menu.Aberto && !EAviso(menu.Atual)) return;
            if (!aviso && menu.Aberto && menu.Atual == qual) { menu.Esconder(); return; }
            // O clique que fechou o menu (perda de foco) não o deve voltar a abrir logo a seguir.
            if (!menu.Aberto && menu.Atual == qual && (DateTime.Now - menu.EscondidoEm).TotalMilliseconds < 250) return;
            var e = Escala;
            var r = new Rectangle(Left + (int)(x * e), Top + (int)(y * e), Math.Max(1, (int)(w * e)), Math.Max(1, (int)(h * e)));
            menu.Abrir(qual, r, ativar, centrado);
        }

        public void MenuFechou()
        {
            Enviar(new Dictionary<string, object> { { "tipo", "menu-fechado" } });
        }

        public void Sair()
        {
            if (aSair) return;
            aSair = true;
            bandeja.Visible = false;
            RemoverAppBar();
            Application.Exit();
        }

        protected override void AoCarregar()
        {
            Enviar(ListaEcras());
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            RemoverAtalhos();
            RemoverAppBar();
            bandeja.Visible = false;
            bandeja.Dispose();
            base.OnFormClosing(e);
        }
    }

    // ------------------------------------------------------------------ Win32

    static class Nativo
    {
        public const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3, ABM_ACTIVATE = 6, ABM_WINDOWPOSCHANGED = 9;
        public const uint ABE_LEFT = 0, ABE_TOP = 1, ABE_RIGHT = 2, ABE_BOTTOM = 3;
        public const int ABN_POSCHANGED = 1, ABN_FULLSCREENAPP = 2;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int left, top, right, bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct APPBARDATA
        {
            public int cbSize;
            public IntPtr hWnd;
            public uint uCallbackMessage;
            public uint uEdge;
            public RECT rc;
            public IntPtr lParam;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MARGINS { public int l, r, t, b; }

        [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);

        [StructLayout(LayoutKind.Sequential)]
        struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
        [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
        [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);

        /// Área de trabalho atual do monitor da janela (lida na hora; a do WinForms fica em cache).
        public static RECT AreaDeTrabalho(IntPtr janela)
        {
            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            GetMonitorInfo(MonitorFromWindow(janela, 2), ref mi); // MONITOR_DEFAULTTONEAREST
            return mi.rcWork;
        }

        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
        [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr depois, int x, int y, int cx, int cy, uint f);

        /// Põe a janela atrás de todas as outras sem a ativar nem a mexer.
        public static void ParaTras(IntPtr h)
        {
            SetWindowPos(h, new IntPtr(1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010); // HWND_BOTTOM; NOSIZE|NOMOVE|NOACTIVATE
        }

        /// Monitor onde a janela está (para comparar com o da barra).
        public static IntPtr MonitorDe(IntPtr h) { return MonitorFromWindow(h, 2); }

        static readonly uint MeuPid = (uint)Process.GetCurrentProcess().Id;

        /// A janela ocupa o monitor inteiro (ecrã inteiro: RDP, vídeo, jogo, apresentação…)?
        /// Ficam de fora o ambiente de trabalho, as barras de tarefas, janelas-ferramenta e as da própria barra.
        public static bool EmEcraInteiro(IntPtr h)
        {
            if (h == IntPtr.Zero || !IsWindowVisible(h) || IsIconic(h)) return false;
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == MeuPid) return false;
            var c = new System.Text.StringBuilder(64);
            GetClassName(h, c, 64);
            string cls = c.ToString();
            if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return false;
            int ex = GetWindowLong(h, -20);
            if ((ex & 0x80) != 0 || (ex & 0x08000000) != 0) return false; // WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE
            RECT r;
            if (!GetWindowRect(h, out r)) return false;
            var mi = new MONITORINFO();
            mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
            var m = mi.rcMonitor;
            return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
        }
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string nome);
        [DllImport("user32.dll")] public static extern bool ReleaseCapture();
        [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
        [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
        [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int valor, int tamanho);
        [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr h, ref MARGINS m);

        [StructLayout(LayoutKind.Sequential)]
        struct ACCENTPOLICY { public int estado, flags, cor, animacao; }

        [StructLayout(LayoutKind.Sequential)]
        struct WINCOMPATTRDATA { public int atributo; public IntPtr dados; public int tamanho; }

        [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr h, ref WINCOMPATTRDATA d);

        /// Desfoque acrílico por trás do conteúdo transparente da WebView2.
        /// modo "dwm" = fundo do sistema (Windows 11); por omissão usa a «accent policy» (Windows 10/11).
        public static void AplicarVidro(IntPtr h, bool redonda)
        {
            try
            {
                if (Environment.GetEnvironmentVariable("VOZ_VIDRO") == "dwm")
                {
                    var m = new MARGINS { l = -1, r = -1, t = -1, b = -1 };
                    DwmExtendFrameIntoClientArea(h, ref m);
                    int acrilico = 3;
                    DwmSetWindowAttribute(h, 38, ref acrilico, 4);
                }
                else Acrilico(h, true);
                CantosRedondos(h, redonda);
                ModoEscuro(h, true);
            }
            catch { }
        }

        /// ACCENT_ENABLE_ACRYLICBLURBEHIND com uma tinta (ABGR) clara ou escura.
        public static void Acrilico(IntPtr h, bool escuro)
        {
            try
            {
                var ap = new ACCENTPOLICY();
                ap.estado = 4;
                ap.flags = 2;
                // AABBGGRR: escuro = grafite translúcido; claro = branco leitoso (como a barra do macOS)
                ap.cor = escuro ? unchecked((int)0x881C1A1A) : unchecked((int)0xB8F7F5F5);
                int n = Marshal.SizeOf(ap);
                IntPtr p = Marshal.AllocHGlobal(n);
                Marshal.StructureToPtr(ap, p, false);
                var d = new WINCOMPATTRDATA { atributo = 19, dados = p, tamanho = n };
                SetWindowCompositionAttribute(h, ref d);
                Marshal.FreeHGlobal(p);
            }
            catch { }
        }

        [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);

        [StructLayout(LayoutKind.Sequential)]
        struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
        [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int estado);

        /// Há quanto tempo não mexes no rato nem no teclado.
        public static uint TempoParadoMs()
        {
            var l = new LASTINPUTINFO();
            l.cbSize = (uint)Marshal.SizeOf(l);
            if (!GetLastInputInfo(ref l)) return 0;
            return unchecked((uint)Environment.TickCount - l.dwTime);
        }

        /// QUERY_USER_NOTIFICATION_STATE (2 = ecrã inteiro, 3 = jogo D3D, 4 = modo de apresentação, 5 = normal).
        public static int EstadoNotificacoes()
        {
            try { int e; return SHQueryUserNotificationState(out e) == 0 ? e : 0; } catch { return 0; }
        }

        /// Nome da app que está a usar o microfone agora (Teams, Zoom…), ou null. O ditado da Voz não conta.
        public static string MicrofoneEmUso()
        {
            try
            {
                using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"))
                {
                    if (k == null) return null;
                    string r = ProcurarMicrofone(k, false);
                    if (r != null) return r;
                    using (var np = k.OpenSubKey("NonPackaged")) return np == null ? null : ProcurarMicrofone(np, true);
                }
            }
            catch { return null; }
        }

        static string ProcurarMicrofone(Microsoft.Win32.RegistryKey k, bool caminhos)
        {
            foreach (var nome in k.GetSubKeyNames())
            {
                if (nome == "NonPackaged") continue;
                if (nome.IndexOf("#.claude#voz#", StringComparison.OrdinalIgnoreCase) >= 0) continue; // o ditado da própria Voz
                using (var s = k.OpenSubKey(nome))
                {
                    if (s == null) continue;
                    object ini = s.GetValue("LastUsedTimeStart"), fim = s.GetValue("LastUsedTimeStop");
                    if (ini is long && (long)ini > 0 && fim is long && (long)fim == 0)
                        return caminhos ? Path.GetFileNameWithoutExtension(nome.Replace('#', '\\')) : nome.Split('_')[0];
                }
            }
            return null;
        }

        /// Ícone da área de notificação, desenhado aqui: quadrado laranja arredondado com uma onda de voz.
        public static Icon IconeVoz(int lado)
        {
            lado = Math.Max(16, lado);
            using (var bmp = new Bitmap(lado, lado, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    float m = lado * 0.03f, l = lado - 2 * m, r = lado * 0.28f;
                    using (var fundo = new System.Drawing.Drawing2D.GraphicsPath())
                    {
                        fundo.AddArc(m, m, 2 * r, 2 * r, 180, 90);
                        fundo.AddArc(m + l - 2 * r, m, 2 * r, 2 * r, 270, 90);
                        fundo.AddArc(m + l - 2 * r, m + l - 2 * r, 2 * r, 2 * r, 0, 90);
                        fundo.AddArc(m, m + l - 2 * r, 2 * r, 2 * r, 90, 90);
                        fundo.CloseFigure();
                        using (var pincel = new SolidBrush(Color.FromArgb(255, 229, 121, 79))) g.FillPath(pincel, fundo);
                    }
                    float[] alturas = { 0.30f, 0.62f, 0.86f, 0.52f, 0.30f };
                    float passo = lado * 0.15f, esp = lado * 0.095f, x0 = (lado - passo * 4 - esp) / 2f;
                    using (var caneta = new Pen(Color.White, esp))
                    {
                        caneta.StartCap = System.Drawing.Drawing2D.LineCap.Round;
                        caneta.EndCap = System.Drawing.Drawing2D.LineCap.Round;
                        for (int i = 0; i < alturas.Length; i++)
                        {
                            float meia = Math.Max(0.5f, (alturas[i] * lado * 0.62f - esp) / 2f);
                            float cx = x0 + esp / 2f + i * passo, cy = lado / 2f;
                            g.DrawLine(caneta, cx, cy - meia, cx, cy + meia);
                        }
                    }
                }
                var h = bmp.GetHicon();
                var ic = (Icon)Icon.FromHandle(h).Clone();
                DestroyIcon(h);
                return ic;
            }
        }

        public static void CantosRedondos(IntPtr h, bool redonda)
        {
            try
            {
                int pref = redonda ? 2 : 1; // DWMWCP_ROUND : DWMWCP_DONOTROUND
                DwmSetWindowAttribute(h, 33, ref pref, 4); // DWMWA_WINDOW_CORNER_PREFERENCE
            }
            catch { }
        }

        public static void ModoEscuro(IntPtr h, bool escuro)
        {
            try
            {
                int v = escuro ? 1 : 0;
                DwmSetWindowAttribute(h, 20, ref v, 4); // DWMWA_USE_IMMERSIVE_DARK_MODE
            }
            catch { }
        }
    }
}
