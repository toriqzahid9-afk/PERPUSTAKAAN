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
        
        // Hapus dari localPending jika sudah ada di server
        localPendingBooks = localPendingBooks.filter(local => !serverBooks.find(server => server.id === local.id));
        
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
        
        // 1. INSTAN: BUKA DULU PAKAI SAMPUL
        try { $(flipbook).turn('destroy'); } catch (e) { }
        flipbook.innerHTML = '';
        
        const firstPageImg = document.createElement('div');
        firstPageImg.className = 'flipbook-page';
        firstPageImg.innerHTML = `<img src="${getCoverUrl(book.coverUrl)}" style="width:100%;height:100%;object-fit:contain;">`;
        flipbook.appendChild(firstPageImg);

        const isMobile = window.innerWidth < 768;
        const bookWidth = Math.floor(isMobile ? (window.innerWidth - 40) : (window.innerWidth > 1000 ? 960 : window.innerWidth * 0.85));
        const bookHeight = Math.floor(isMobile ? (window.innerHeight * 0.8) : (window.innerHeight * 0.75));

        $(flipbook).turn({
            width: bookWidth,
            height: bookHeight,
            autoCenter: true,
            display: isMobile ? 'single' : 'double',
            acceleration: true,
            elevation: 50,
            duration: 600
        });

        spinner.style.display = 'none';

        // 2. MUAT PDF DI BACKGROUND
        let loadingTask;
        const localBlob = await getFromLocalDisk(id);
        if (localBlob) {
            loadingTask = pdfjsLib.getDocument({ data: await localBlob.arrayBuffer() });
        } else if (book.pdfUrl) {
            loadingTask = pdfjsLib.getDocument(book.pdfUrl);
        } else {
            console.warn("File belum ada di server.");
            return;
        }

        const pdf = await loadingTask.promise;
        
        async function renderPageToCanvas(num) {
            const page = await pdf.getPage(num);
            const viewport = page.getViewport({ scale: isMobile ? 1.0 : 1.3 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            return canvas;
        }

        // Update hal 1 & tambah halaman lain
        (async () => {
            const canvas1 = await renderPageToCanvas(1);
            $(flipbook).find('.flipbook-page').first().empty().append(canvas1);
            
            for (let i = 2; i <= pdf.numPages; i++) {
                if (overlay.style.display === 'none') break;
                const canvas = await renderPageToCanvas(i);
                const pageDiv = document.createElement('div');
                pageDiv.className = 'flipbook-page';
                pageDiv.appendChild(canvas);
                $(flipbook).turn('addPage', pageDiv, i);
                await new Promise(r => setTimeout(r, 50));
            }
        })();

    } catch (err) {
        console.error('Reader Error:', err);
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
        // 1. VALIDASI
        if (!tempFiles.pdf || !tempFiles.pdf.blob) {
            alert('Pilih file PDF terlebih dahulu!');
            return;
        }

        const title = document.getElementById('add-title').value.trim();
        const author = document.getElementById('add-author').value.trim();
        const pdfFile = tempFiles.pdf.blob;
        const coverFile = tempFiles.cover;
        const timestamp = Date.now();

        // 2. PROSES INSTAN DI LOKAL DULU
        saveBtn.disabled = true;
        saveBtn.innerText = 'MEMPROSES...';
        
        let localCoverUrl = null;
        let compressedBlob = null;
        if (coverFile) {
            // Kompresi Gambar agar super cepat
            const canvas = document.createElement('canvas');
            const img = new Image();
            img.src = URL.createObjectURL(coverFile);
            compressedBlob = await new Promise(res => {
                img.onload = () => {
                    const ctx = canvas.getContext('2d');
                    const scale = 400 / img.width;
                    canvas.width = 400; canvas.height = img.height * scale;
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    canvas.toBlob(res, 'image/jpeg', 0.7);
                }
            });
            localCoverUrl = URL.createObjectURL(compressedBlob);
        }

        const newDocRef = dbFirebase.collection('books').doc();
        const bookId = newDocRef.id;
        
        // Tambahkan ke UI secara instan!
        const newBook = {
            id: bookId,
            title: title,
            author: author,
            coverUrl: localCoverUrl,
            status: 'uploading',
            createdAt: new Date()
        };
        
        localPendingBooks.push(newBook);
        books = [newBook, ...books]; // Munculkan paling atas sementara
        render();
        
        // Simpan PDF ke cache lokal sementara
        saveToLocalDisk(bookId, pdfFile);

        alert('✅ BERHASIL! Buku ditambahkan. Proses upload berjalan di latar belakang.');
        
        // RESET FORM SEGERA
        e.target.reset();
        document.getElementById('pdf-label').textContent = 'Unggah File PDF';
        document.getElementById('cover-label').textContent = 'Unggah Gambar Sampul';
        const currentPdf = pdfFile; // Copy untuk background task
        tempFiles = { pdf: null, cover: null };
        saveBtn.disabled = false;
        saveBtn.innerText = originalText;

        // 4. PROSES UPLOAD ASLI DI LATAR BELAKANG (BACKGROUND)
        (async () => {
            try {
                let coverUrl = null;
                if (compressedBlob) {
                    console.log('Background upload cover dimulai...');
                    const coverRef = storageFirebase.ref(`covers/cover_${timestamp}.jpg`);
                    await coverRef.put(compressedBlob);
                    coverUrl = await coverRef.getDownloadURL();
                }

                console.log('Background menyimpan metadata...');
                await newDocRef.set({
                    title: title,
                    author: author,
                    coverUrl: coverUrl,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    status: 'ready'
                });

                console.log('Background upload PDF dimulai...');
                const pdfRef = storageFirebase.ref(`books/pdf_${bookId}`);
                await pdfRef.put(currentPdf);
                const pdfUrl = await pdfRef.getDownloadURL();

                await newDocRef.update({
                    pdfUrl: pdfUrl
                });
                
                // Hapus dari pending setelah selesai (opsional karena sudah di-handle oleh onSnapshot)
                localPendingBooks = localPendingBooks.filter(b => b.id !== bookId);
                console.log('Semua file tuntas di awan!');
            } catch (err) {
                console.error('Background Upload Error:', err);
            }
        })();

    } catch (err) {
        console.error('Error:', err);
        alert('❌ GAGAL: ' + err.message);
        saveBtn.disabled = false;
        saveBtn.innerText = originalText;
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

function getCoverUrl(coverUrl) {
    if (!coverUrl) return 'https://via.placeholder.com/150x220/222/00f2ff?text=DELPIK';
    return coverUrl;
}

function render() {
    const grid = document.getElementById('book-grid');
    const list = document.getElementById('admin-book-list');

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

    if (mobileBtn) mobileBtn.onclick = toggleMobileMenu;
    if (closeBtn) closeBtn.onclick = toggleMobileMenu;
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
