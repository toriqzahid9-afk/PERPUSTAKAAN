// =============================================
//   DELPIK DIGITAL - JavaScript
// =============================================

// Konfigurasi PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// --- STATE GLOBAL ---
let books = [];
let isAdmin = false;
let tempFiles = { pdf: null, cover: null };
// =============================================
//   FIREBASE CONFIGURATION
// =============================================
const firebaseConfig = {
  apiKey: "AIzaSyBV_wDXwj4OWplfjeFdkgW_91T60t2aXTY",
  authDomain: "perpustakaandigital-46861.firebaseapp.com",
  projectId: "perpustakaandigital-46861",
  storageBucket: "perpustakaandigital-46861.firebasestorage.app",
  messagingSenderId: "884650687443",
  appId: "1:884650687443:web:2c757bde39908cc7524d26",
  measurementId: "G-LCWNRT59KT"
};

let dbFirebase, storageFirebase;
try {
    firebase.initializeApp(firebaseConfig);
    dbFirebase = firebase.firestore();
    storageFirebase = firebase.storage();
} catch (e) {
    console.warn("Firebase belum dikonfigurasi.", e);
}

// =============================================
//   DATABASE (Firebase)
// =============================================
async function initDB() {
    if (!dbFirebase) {
        console.warn("Harap masukkan Konfigurasi Firebase di script.js");
        return;
    }
    loadBooksFromDB();
}

async function loadBooksFromDB() {
    try {
        const snapshot = await dbFirebase.collection('books').orderBy('createdAt', 'desc').get();
        books = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        render();
    } catch (e) {
        console.error("Gagal memuat buku dari Firebase:", e);
    }
}

// =============================================
//   FLIPBOOK / READER LOGIC
// =============================================

async function openBook(id) {
    const book = books.find(b => b.id === id);
    if (!book) return;

    const overlay = document.getElementById('reader-overlay');
    const flipbook = document.getElementById('flipbook');
    const spinner = document.getElementById('loading-spinner');

    overlay.style.display = 'flex';
    spinner.style.display = 'flex';
    try {
        console.log('Mencoba memuat buku:', book.title);

        // Hancurkan instance turn.js sebelumnya jika ada
        try { $(flipbook).turn('destroy'); } catch (e) { }
        flipbook.innerHTML = '';

        if (typeof pdfjsLib === 'undefined') {
            throw new Error('Library PDF.js belum dimuat. Periksa koneksi internet Anda.');
        }

        // Karena sudah online, PDF bisa langsung dimuat dari URL
        if (!book.pdfUrl) throw new Error('URL PDF tidak ditemukan pada objek buku.');

        // Muat dari Firebase Storage URL
        const pdf = await pdfjsLib.getDocument(book.pdfUrl).promise;

        console.log('PDF berhasil dimuat. Jumlah halaman:', pdf.numPages);

        // Fungsi helper untuk render satu halaman
        async function renderPage(num) {
            const page = await pdf.getPage(num);
            const isMobile = window.innerWidth < 768;
            const viewport = page.getViewport({ scale: isMobile ? 1.0 : 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const pageDiv = document.createElement('div');
            pageDiv.className = 'flipbook-page';
            pageDiv.appendChild(canvas);
            return pageDiv;
        }

        // Render 2 halaman pertama secara paralel untuk kecepatan (Fast Start)
        const initialPagesToLoad = Math.min(pdf.numPages, 4);
        const initialPagePromises = [];
        for (let i = 1; i <= initialPagesToLoad; i++) {
            initialPagePromises.push(renderPage(i));
        }

        const renderedPages = await Promise.all(initialPagePromises);
        renderedPages.forEach(p => flipbook.appendChild(p));

        // Inisialisasi Turn.js segera setelah halaman awal siap
        const isMobile = window.innerWidth < 768;

        // Kurangi ukuran buku agar menyisakan ruang untuk sampul (cover & spine)
        // Cover padding & border takes up roughly ~40px horizontally and ~20px vertically
        const bookWidth = Math.floor(isMobile ? (window.innerWidth - 40) : (window.innerWidth > 1000 ? 960 : window.innerWidth * 0.85));
        const bookHeight = Math.floor(isMobile ? (window.innerHeight * 0.8) : (window.innerHeight * 0.75));

        $(flipbook).turn({
            width: bookWidth,
            height: bookHeight,
            autoCenter: true,
            display: isMobile ? 'single' : 'double',
            acceleration: true,
            gradients: true,
            elevation: 100,
            duration: 800,
            pages: pdf.numPages, // Beritahu turn.js total halaman sebenarnya
            when: {
                turning: function (e, page) {
                    const pageNum = document.getElementById('page-number');
                    if (pageNum) pageNum.innerText = `Hal. ${page}`;
                }
            }
        });

        spinner.style.display = 'none';
        console.log('Flipbook started with initial pages');

        // Render sisa halaman secara berurutan di background agar tidak crash/lemot
        (async () => {
            for (let i = initialPagesToLoad + 1; i <= pdf.numPages; i++) {
                try {
                    // Cek apakah reader masih terbuka sebelum lanjut render
                    if (document.getElementById('reader-overlay').style.display === 'none') break;

                    const pageDiv = await renderPage(i);
                    $(flipbook).turn('addPage', pageDiv, i);

                    // Beri jeda kecil agar browser tetap responsif
                    await new Promise(r => setTimeout(r, 50));
                } catch (bgErr) {
                    console.warn(`Gagal render halaman ${i} di background:`, bgErr);
                }
            }
            console.log('Semua halaman berhasil di-render di background');
        })();

    } catch (err) {
        console.error('CRITICAL ERROR:', err);
        alert('Gagal memuat buku: ' + err.message);
        closeReader();
    }
}

function closeReader() {
    document.getElementById('reader-overlay').style.display = 'none';
    try {
        $('#flipbook').turn('destroy');
    } catch (e) { /* abaikan jika belum diinisialisasi */ }
}

// =============================================
//   ADMIN: UPLOAD & KELOLA BUKU
// =============================================

function handleFileChange(input, labelId) {
    if (input.files && input.files[0]) {
        const file = input.files[0];

        if (labelId === 'pdf-label') {
            tempFiles.pdf = { blob: file, name: file.name };
        } else {
            tempFiles.cover = file;
        }

        const label = document.getElementById(labelId);
        label.textContent = file.name;
        label.classList.add('text-cyan-400');
    }
}

document.getElementById('add-book-form').onsubmit = async (e) => {
    e.preventDefault();

    const saveBtn = document.getElementById('save-btn');
    const originalText = saveBtn.innerText;

    try {
        saveBtn.innerText = 'MENGUNGGAH...';
        saveBtn.disabled = true;

        if (!dbFirebase) {
            alert("Firebase belum dikonfigurasi! Harap edit file script.js terlebih dahulu.");
            saveBtn.innerText = originalText;
            saveBtn.disabled = false;
            return;
        }

        if (!tempFiles.pdf || !tempFiles.pdf.blob) {
            alert('Pilih file PDF terlebih dahulu!');
            saveBtn.innerText = originalText;
            saveBtn.disabled = false;
            return;
        }

        // 1. Upload PDF ke Firebase Storage
        const pdfFile = tempFiles.pdf.blob;
        const pdfRef = storageFirebase.ref(`books/pdf_${Date.now()}_${pdfFile.name}`);
        await pdfRef.put(pdfFile);
        const pdfUrl = await pdfRef.getDownloadURL();

        // 2. Upload Cover ke Firebase Storage (jika ada)
        let coverUrl = null;
        if (tempFiles.cover) {
            const coverFile = tempFiles.cover;
            const coverRef = storageFirebase.ref(`covers/cover_${Date.now()}_${coverFile.name}`);
            await coverRef.put(coverFile);
            coverUrl = await coverRef.getDownloadURL();
        }

        // 3. Simpan Metadata ke Firestore
        const newBook = {
            title: document.getElementById('add-title').value,
            author: document.getElementById('add-author').value,
            pdfUrl: pdfUrl,
            coverUrl: coverUrl,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await dbFirebase.collection('books').add(newBook);
        newBook.id = docRef.id;

        books.unshift(newBook);
        render();
        e.target.reset();

        document.getElementById('pdf-label').textContent = 'Unggah File PDF';
        document.getElementById('cover-label').textContent = 'Unggah Gambar Sampul';
        document.getElementById('pdf-label').classList.remove('text-cyan-400');
        document.getElementById('cover-label').classList.remove('text-cyan-400');
        tempFiles = { pdf: null, cover: null };

        alert('Buku Berhasil Diunggah dan Tersimpan Online!');
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;

    } catch (err) {
        console.error('Error saat menyimpan:', err);
        alert('Gagal menyimpan buku! Pastikan Firebase sudah dikonfigurasi dengan benar.');
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
};

async function deleteBook(id) {
    if (!confirm('Hapus buku ini secara permanen dari server?')) return;
    try {
        await dbFirebase.collection('books').doc(id).delete();
        books = books.filter(b => b.id !== id);
        render();
    } catch (err) {
        console.error("Gagal menghapus:", err);
        alert("Gagal menghapus buku!");
    }
}

// =============================================
//   RENDER UI
// =============================================

function render() {
    const grid = document.getElementById('book-grid');
    const list = document.getElementById('admin-book-list');

    const getCoverUrl = (coverUrl) => {
        if (!coverUrl) return 'https://via.placeholder.com/150x220/222/00f2ff?text=DELPIK';
        return coverUrl;
    };

    // --- Render kartu buku di halaman utama ---
    grid.innerHTML = books.map(b => `
        <div class="book-card" onclick="openBook('${b.id}')">
            <div class="book-cover-container">
                <img src="${getCoverUrl(b.coverUrl)}"
                     alt="Sampul ${b.title}">
            </div>
            <div class="flex flex-col justify-between py-2">
                <div>
                    <h4 class="font-bold text-white text-xs uppercase">${b.title}</h4>
                    <p class="text-[10px] text-gray-500 mt-1">${b.author}</p>
                </div>
                <div class="text-[8px] text-cyan-500 font-bold tracking-widest mt-4">KLIK UNTUK MEMBACA</div>
            </div>
        </div>
    `).join('');

    // --- Render tabel di dashboard admin ---
    list.innerHTML = books.map(b => `
        <tr>
            <td class="text-xs font-bold uppercase">${b.title}</td>
            <td class="text-[10px] text-gray-500">${b.author}</td>
            <td class="text-right">
                <button onclick="deleteBook('${b.id}')" class="text-red-500/50 hover:text-red-500">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// =============================================
//   NAVIGASI SPA (SINGLE PAGE APPLICATION)
// =============================================

function showPage(id) {
    const el = document.getElementById(id);
    if (!el) return;
    document.querySelectorAll('.spa-content').forEach(el => el.classList.remove('active'));
    el.classList.add('active');
}

function handleLogoClick() {
    isAdmin ? showPage('admin-dashboard') : showPage('login');
}

function logout() {
    isAdmin = false;
    document.getElementById('admin-link')?.classList.add('hidden');
    document.getElementById('logout-btn')?.classList.add('hidden');
    document.getElementById('login-link')?.classList.remove('hidden');
    document.getElementById('admin-link-mobile')?.classList.add('hidden');
    document.getElementById('logout-btn-mobile')?.classList.add('hidden');
    document.getElementById('login-link-mobile')?.classList.remove('hidden');
    showPage('main-view');
}

// =============================================
//   MOBILE MENU LOGIC
// =============================================

function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (menu) menu.classList.toggle('active');
}

function closeAndShowPage(pageId) {
    toggleMobileMenu();
    showPage(pageId);
}

// =============================================
//   INISIALISASI & EVENT LISTENERS
// =============================================

document.addEventListener('DOMContentLoaded', () => {
    initDB();

    // -- Mobile Menu --
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const closeBtn = document.getElementById('close-mobile-menu');
    const mobileMenu = document.getElementById('mobile-menu');

    if (mobileBtn) mobileBtn.addEventListener('click', toggleMobileMenu);
    if (closeBtn) closeBtn.addEventListener('click', toggleMobileMenu);
    if (mobileMenu) {
        mobileMenu.addEventListener('click', function (e) {
            if (e.target === this) toggleMobileMenu();
        });
    }

    // -- Search --
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            const query = this.value.toLowerCase().trim();
            const cards = document.querySelectorAll('#book-grid .book-card');
            cards.forEach(card => {
                const title = card.querySelector('h4').textContent.toLowerCase();
                const author = card.querySelector('p').textContent.toLowerCase();
                card.style.display = (title.includes(query) || author.includes(query)) ? '' : 'none';
            });
        });
    }

    // -- Login Form --
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.onsubmit = (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;

            if (email === 'admin@perpus.id' && pass === '654321') {
                isAdmin = true;
                document.getElementById('admin-link')?.classList.remove('hidden');
                document.getElementById('logout-btn')?.classList.remove('hidden');
                document.getElementById('login-link')?.classList.add('hidden');
                document.getElementById('admin-link-mobile')?.classList.remove('hidden');
                document.getElementById('logout-btn-mobile')?.classList.remove('hidden');
                document.getElementById('login-link-mobile')?.classList.add('hidden');
                showPage('admin-dashboard');
                render();
            } else {
                alert('Email atau Password salah!');
            }
        };
    }

    // -- Resize Helper --
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            document.getElementById('mobile-menu')?.classList.remove('active');
        }
    });
});
