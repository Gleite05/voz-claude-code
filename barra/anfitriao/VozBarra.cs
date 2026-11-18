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
        public static readonly string Pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "voz");
        public static readonly string PastaBarra = Path.Combine(Pasta, "barra");
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        /// Sem vidro: fundo opaco (para Windows sem acrílico, ou se o vidro der problemas).
        public static readonly bool SemVidro = Environment.GetEnvironmentVariable("VOZ_SEM_VIDRO") == "1" || File.Exists(Path.Combine(PastaBarra, "sem-vidro"));

        [STAThread]
        static void Main()
        {
            bool novo;
            using (var mutex = new Mutex(true, "Local\\VozBarra-ClaudeCode", out novo))
            {
                if (!novo) return;
                try { Nativo.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Registo.Escrever("arranque");
                var dados = DadosBarra.Ler();
                if (dados == null) { Registo.Escrever("sem barra.json — corre /voz:barra instalar"); return; }
                if (!Servidor.Garantir(dados)) { Registo.Escrever("o servidor da voz não arrancou"); }
                Application.Run(new Barra(dados));
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

        public double Escala
        {
            get { try { return Nativo.GetDpiForWindow(Handle) / 96.0; } catch { return 1.0; } }
        }

        public void TemaEscuro(bool escuro) { Nativo.ModoEscuro(Handle, escuro); }

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

        public void Abrir(string menu, Rectangle ancoraEcra, bool ativarJanela)
        {
            Atual = menu;
            ancora = ancoraEcra;
            ativar = ativarJanela;
            aEsperarTamanho = true;
            if (!Pronta) { pendente = menu; return; }
            Enviar(new Dictionary<string, object> { { "tipo", "menu" }, { "menu", menu } });
        }

        protected override void AoCarregar()
        {
            if (pendente == null) return;
            var m = pendente;
            pendente = null;
            Enviar(new Dictionary<string, object> { { "tipo", "menu" }, { "menu", m } });
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
        }

        void Posicionar(int w, int h)
        {
            var area = Screen.FromRectangle(ancora).WorkingArea;
            var ecra = Screen.FromRectangle(ancora).Bounds;
            int x, y;
            int folga = (int)(4 * Escala);
            bool aviso = Atual.StartsWith("aviso:");
            switch (barra.Posicao)
            {
                case "fundo": x = aviso ? ancora.Right - w - folga : ancora.Left; y = ancora.Top - h - folga; break;
                case "esquerda": x = ancora.Right + folga; y = ancora.Top + (aviso ? folga : 0); break;
                case "direita": x = ancora.Left - w - folga; y = ancora.Top + (aviso ? folga : 0); break;
                default: x = aviso ? ancora.Right - w - folga : ancora.Left; y = ancora.Bottom + folga; break;
            }
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
        bool appBarRegistada;
        int larguraFlutuante = 520;
        readonly System.Windows.Forms.Timer relogio = new System.Windows.Forms.Timer();
        bool escondidaVisivel = true;
        DateTime ratoSaiuEm = DateTime.MinValue;
        DateTime mostrarAte = DateTime.MinValue;
        bool aSair;

        public Barra(DadosBarra dados) : base(dados, false)
        {
            mensagemAppBar = Nativo.RegisterWindowMessage("VozBarraAppBar");
            Posicao = DadosBarra.PosicaoGuardada();
            Text = "Voz";
            menu = new Menu(dados, this);
            relogio.Interval = 120;
            relogio.Tick += delegate { Vigiar(); };
            Iniciar(dados.Url("barra"));
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            menu.Show(); // carrega a página do menu já, estacionada fora do ecrã
            menu.Estacionar();
            AplicarPosicao(Posicao);
            relogio.Start();
        }

        int Espessura(bool vertical)
        {
            return (int)Math.Round((vertical ? 40 : 30) * Escala);
        }

        Rectangle Ecra { get { return Screen.PrimaryScreen.Bounds; } }

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
            TopMost = true;
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
            if (appBarRegistada && m.Msg == (int)mensagemAppBar)
            {
                int aviso = m.WParam.ToInt32();
                if (aviso == Nativo.ABN_POSCHANGED) PosicionarAppBar(Posicao);
                else if (aviso == Nativo.ABN_FULLSCREENAPP) TopMost = m.LParam == IntPtr.Zero;
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

        // ---------- escondida / flutuante ----------
        void Vigiar()
        {
            if (Posicao != "escondida") return;
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
                case "abrir":
                    object at;
                    bool ativar = !(msg.TryGetValue("ativar", out at) && at is bool && !(bool)at);
                    AbrirMenu(Texto(msg, "menu"), Numero(msg, "x"), Numero(msg, "y"), Numero(msg, "w"), Numero(msg, "h"), ativar);
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
            }
        }

        void AbrirMenu(string qual, double x, double y, double w, double h, bool ativar)
        {
            bool aviso = qual.StartsWith("aviso:");
            // Um aviso nunca tapa um menu que abriste à mão.
            if (aviso && menu.Aberto && !menu.Atual.StartsWith("aviso:")) return;
            if (!aviso && menu.Aberto && menu.Atual == qual) { menu.Esconder(); return; }
            // O clique que fechou o menu (perda de foco) não o deve voltar a abrir logo a seguir.
            if (!menu.Aberto && menu.Atual == qual && (DateTime.Now - menu.EscondidoEm).TotalMilliseconds < 250) return;
            var e = Escala;
            var r = new Rectangle(Left + (int)(x * e), Top + (int)(y * e), Math.Max(1, (int)(w * e)), Math.Max(1, (int)(h * e)));
            menu.Abrir(qual, r, ativar);
        }

        public void MenuFechou()
        {
            Enviar(new Dictionary<string, object> { { "tipo", "menu-fechado" } });
        }

        public void Sair()
        {
            if (aSair) return;
            aSair = true;
            RemoverAppBar();
            Application.Exit();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            RemoverAppBar();
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
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern uint RegisterWindowMessage(string nome);
        [DllImport("user32.dll")] public static extern bool ReleaseCapture();
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
                ap.cor = escuro ? unchecked((int)0x701A1A1E) : unchecked((int)0x70F4F4F6);
                int n = Marshal.SizeOf(ap);
                IntPtr p = Marshal.AllocHGlobal(n);
                Marshal.StructureToPtr(ap, p, false);
                var d = new WINCOMPATTRDATA { atributo = 19, dados = p, tamanho = n };
                SetWindowCompositionAttribute(h, ref d);
                Marshal.FreeHGlobal(p);
            }
            catch { }
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
