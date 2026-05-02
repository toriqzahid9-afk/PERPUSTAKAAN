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
    if (!dbFirebase) return;
    loadBooksFromDB();
}

let localPendingBooks = []; // Penampung buku yang sedang diupload

async function loadBooksFromDB() {
    if (!dbFirebase) return;
    
    // Sinkronisasi Real-time
    dbFirebase.collection('books').orderBy('createdAt', 'desc').onSnapshot((snapshot) => {
        const serverBooks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Gabungkan buku server dengan buku yang masih proses upload di HP ini
        books = [...localPendingBooks, ...serverBooks];
        render();
        console.log("Data sinkron!");
    }, (error) => {
        console.error("Gagal sinkronisasi:", error);
    });
}

// --- SISTEM DISK LOKAL PERMANEN (INDEXEDDB) ---
const dbName = "PerpusDelpikDB";
function saveToLocalDisk(id, blob) {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => e.target.result.createObjectStore("pdf_cache");
    request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction("pdf_cache", "readwrite");
        tx.objectStore("pdf_cache").put(blob, id);
    };
}

function getFromLocalDisk(id) {
    return new Promise((resolve) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("pdf_cache")) return resolve(null);
            const tx = db.transaction("pdf_cache", "readonly");
            const getReq = tx.objectStore("pdf_cache").get(id);
            getReq.onsuccess = () => resolve(getReq.result);
            getReq.onerror = () => resolve(null);
        };
        request.onupgradeneeded = (e) => e.target.result.createObjectStore("pdf_cache");
    });
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
        
        // --- 1. JALUR KILAT (TURBO DISK + STREAMING) ---
        let loadingTask;
        const localBlob = await getFromLocalDisk(id);

        if (localBlob) {
            console.log('Turbo Disk: Membuka dari memori permanen HP (INSTAN!)');
            const pdfData = await localBlob.arrayBuffer();
            loadingTask = pdfjsLib.getDocument({ data: pdfData });
        } else if (book.pdfUrl) {
            console.log('Streaming dari server...');
            loadingTask = pdfjsLib.getDocument(book.pdfUrl);
        } else {
            alert('Sabar bro, file sedang dikirim ke awan. Jangan direfresh sampai muncul notifikasi BERHASIL ya!');
            overlay.style.display = 'none';
            return;
        }

        const pdf = await loadingTask.promise;
        
        try { $(flipbook).turn('destroy'); } catch (e) { }
        flipbook.innerHTML = '';

        // Fungsi render kilat
        async function renderPage(num) {
            const page = await pdf.getPage(num);
            const isMobile = window.innerWidth < 768;
            const viewport = page.getViewport({ scale: isMobile ? 1.0 : 1.3 });
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

        // --- 2. FAST START: RENDER MINIMAL DULU ---
        const isMobile = window.innerWidth < 768;
        const initialLoad = isMobile ? 1 : 2; // Mobile cuma nunggu 1 hal, Desktop 2 hal
        
        for (let i = 1; i <= Math.min(pdf.numPages, initialLoad); i++) {
            const pageDiv = await renderPage(i);
            flipbook.appendChild(pageDiv);
        }

        // --- 3. INISIALISASI TURN.JS (LANGSUNG BUKA!) ---

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
    const progressContainer = document.getElementById('upload-progress-container');
    const progressBar = document.getElementById('upload-progress-bar');

    try {
        saveBtn.disabled = true;
        
        if (!tempFiles.pdf || !tempFiles.pdf.blob) {
            alert('Pilih file PDF terlebih dahulu!');
            saveBtn.disabled = false;
            return;
        }

        const title = document.getElementById('add-title').value;
        const author = document.getElementById('add-author').value;
        const pdfFile = tempFiles.pdf.blob;
        const coverFile = tempFiles.cover;

        // -- Fungsi Kompresi Gambar (Agar Upload Instan) --
        async function compressImage(file) {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 400;
                        const scale = MAX_WIDTH / img.width;
                        canvas.width = MAX_WIDTH;
                        canvas.height = img.height * scale;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7);
                    };
                };
            });
        }

        // 1. BUAT BUKU "BAYANGAN"
        const tempId = 'temp_' + Date.now();
        const tempBook = {
            id: tempId,
            title: title + ' (MENYIMPAN...)',
            author: author,
            coverUrl: coverFile ? URL.createObjectURL(coverFile) : null,
            isUploading: true
        };

        localPendingBooks.unshift(tempBook);
        render(); 

        progressContainer.classList.remove('hidden');
        progressBar.style.width = '10%'; // Langsung lompat 10% agar tidak macet
        saveBtn.innerText = 'MEMPROSES...';

        const preventRefresh = (e) => {
            e.preventDefault();
            e.returnValue = 'Buku sedang diupload!';
        };
        window.addEventListener('beforeunload', preventRefresh);

        // --- 1. PENYIMPANAN KILAT (INSTAN KE MEMORI LOKAL + FIRESTORE) ---
        const startInstantUpload = async () => {
            try {
                // Simpan info dasar ke Firestore
                const docRef = await dbFirebase.collection('books').add({
                    title: title,
                    author: author,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'ready' // Langsung set READY agar bisa dibuka
                });

                const bookId = docRef.id;

                // SIMPAN KE DISK LOKAL PERMANEN (Agar bisa dibuka meskipun direfresh)
                saveToLocalDisk(bookId, pdfFile);

                // SIMPAN KE TEMPFIILES AGAR BISA DIBUKA INSTAN SAAT INI JUGA
                // (Ini adalah cache memori agar klik baca langsung jreeeng)
                books = books.map(b => b.title.includes(title) ? { ...b, id: bookId, isUploading: true } : b);
                render();

                alert('✅ INSTAN BERHASIL! Buku sudah masuk koleksi dan SIAP BACA sekarang juga.');

                // 2. PROSES UPLOAD FILE ASLI DI BACKGROUND (TIDAK MENGGANGGU USER)
                const pdfRef = storageFirebase.ref(`books/pdf_${bookId}`);
                const pdfTask = pdfRef.put(pdfFile);
                
                let coverUrl = null;
                if (coverFile) {
                    const blob = await compressImage(coverFile);
                    const coverRef = storageFirebase.ref(`covers/cover_${bookId}.jpg`);
                    await coverRef.put(blob);
                    coverUrl = await coverRef.getDownloadURL();
                }

                await pdfTask;
                const pdfUrl = await pdfRef.getDownloadURL();

                // Update data di Firestore jika sudah tuntas
                await dbFirebase.collection('books').doc(bookId).update({
                    pdfUrl: pdfUrl,
                    coverUrl: coverUrl
                });

                console.log('Sync Cloud Selesai!');
            } catch (err) {
                console.error('Error:', err);
                alert('❌ GAGAL! Periksa koneksi internet atau Rules Firebase kamu.');
            } finally {
                progressContainer.classList.add('hidden');
                saveBtn.innerText = originalText;
                saveBtn.disabled = false;
                window.removeEventListener('beforeunload', preventRefresh);
            }
        };

        startInstantUpload();
        e.target.reset();
        document.getElementById('pdf-label').textContent = 'Unggah File PDF';
        document.getElementById('cover-label').textContent = 'Unggah Gambar Sampul';
        tempFiles = { pdf: null, cover: null };

        // 3. FEEDBACK FORM SELESAI (1 DETIK)
        e.target.reset();
        document.getElementById('pdf-label').textContent = 'Unggah File PDF';
        document.getElementById('cover-label').textContent = 'Unggah Gambar Sampul';
        tempFiles = { pdf: null, cover: null };

    } catch (err) {
        console.error('Error:', err);
        alert('Gagal memproses buku.');
    } finally {
        saveBtn.innerText = originalText;
        saveBtn.disabled = false;
    }
};

async function deleteBook(id) {
    if (!confirm('Hapus buku ini secara permanen?')) return;
    try {
        await dbFirebase.collection('books').doc(id).delete();
        // UI akan terupdate otomatis via onSnapshot
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
        <div class="book-card" onclick="openBook('${b.id}')" style="cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;">
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
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const pass = document.getElementById('password').value.trim();

            if (email === 'admin@perpus.id' && pass === '654321') {
                isAdmin = true;
                
                // Update UI Navigation
                document.getElementById('admin-link')?.classList.remove('hidden');
                document.getElementById('logout-btn')?.classList.remove('hidden');
                document.getElementById('login-link')?.classList.add('hidden');
                
                document.getElementById('admin-link-mobile')?.classList.remove('hidden');
                document.getElementById('logout-btn-mobile')?.classList.remove('hidden');
                document.getElementById('login-link-mobile')?.classList.add('hidden');
                
                showPage('admin-dashboard');
                render();
            } else {
                alert('Email atau Password salah! Pastikan Email: admin@perpus.id dan Password: 654321');
            }
        });
    }

    // -- Resize Helper --
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            document.getElementById('mobile-menu')?.classList.remove('active');
        }
    });
});
