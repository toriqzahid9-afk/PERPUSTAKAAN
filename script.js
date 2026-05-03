// =============================================
//   DELPIK DIGITAL - JavaScript
// =============================================

// Konfigurasi PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// --- STATE GLOBAL ---
let books = [];
let isAdmin = sessionStorage.getItem('isAdmin') === 'true';
let tempFiles = { pdf: null, cover: null };
let uploadTasksCount = 0;

window.addEventListener('beforeunload', (e) => {
    if (uploadTasksCount > 0) {
        e.preventDefault();
        e.returnValue = 'Buku sedang di-upload ke server. Jika Anda keluar, upload akan gagal. Yakin ingin keluar?';
    }
});

// =============================================
//   API CONFIGURATION
// =============================================
// Isi dengan URL backend PHP kamu jika di-host terpisah, misalnya 'https://api.domain.com/'
// Biarkan kosong jika di folder yang sama.
const API_URL = ''; 

// =============================================
//   DATABASE (API)
// =============================================
async function initDB() {
    loadBooksFromDB();
}

let localPendingBooks = []; // Penampung buku yang sedang diupload

async function loadBooksFromDB() {
    try {
        const response = await fetch(API_URL + 'get_books.php');
        const serverBooks = await response.json();
        
        // Hapus dari localPending jika sudah ada di server
        localPendingBooks = localPendingBooks.filter(local => !serverBooks.find(server => server.id === local.id));
        
        // Gabungkan buku server dengan buku yang masih proses upload di HP ini
        books = [...localPendingBooks, ...serverBooks];
        render();
        console.log("Data sukses diambil dari API!");
    } catch (error) {
        console.error("Gagal sinkronisasi API:", error);
    }
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
        
        // 1. INSTAN: BUKA DULU PAKAI SAMPUL (STATIS SEMENTARA)
        try { $(flipbook).turn('destroy'); } catch (e) { }
        flipbook.innerHTML = '';
        
        const isMobile = window.innerWidth < 768;
        // Di mobile, ukuran buku persis sama dengan layar (Full Screen)
        const bookWidth = Math.floor(isMobile ? window.innerWidth : (window.innerWidth > 1000 ? 960 : window.innerWidth * 0.85));
        // Sisakan ruang sedikit untuk tombol di desktop, tapi full height di mobile
        const bookHeight = Math.floor(isMobile ? window.innerHeight : (window.innerHeight * 0.75));

        const firstPageImg = document.createElement('div');
        firstPageImg.className = 'flipbook-page';
        // Style sementara agar gambar berada di tengah dengan ukuran seperti buku
        firstPageImg.style.width = isMobile ? `${bookWidth}px` : `${bookWidth/2}px`;
        firstPageImg.style.height = `${bookHeight}px`;
        firstPageImg.style.margin = '0 auto';
        firstPageImg.innerHTML = `<img src="${getCoverUrl(book.coverUrl)}" style="width:100%;height:100%;object-fit:contain;background-color:white;">`;
        flipbook.appendChild(firstPageImg);

        spinner.style.display = 'none'; // Sembunyikan spinner karena cover sudah tampil

        // Anti-scroll di background
        document.body.style.overflow = 'hidden';

        // 2. MUAT PDF DI BACKGROUND
        let loadingTask;
        const localBlob = await getFromLocalDisk(id);
        if (localBlob) {
            loadingTask = pdfjsLib.getDocument({ data: await localBlob.arrayBuffer() });
        } else if (book.pdfUrl) {
            let fullPdfUrl = book.pdfUrl.startsWith('http') ? book.pdfUrl : API_URL + book.pdfUrl;
            loadingTask = pdfjsLib.getDocument(fullPdfUrl);
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

        // Hitung total halaman yang benar untuk Turn.js (genap untuk mode double)
        let totalPages = pdf.numPages;
        if (!isMobile && totalPages % 2 !== 0) {
            totalPages++; 
        }

        // Hapus styling sementara sebelum inisialisasi Turn.js
        firstPageImg.style.width = '';
        firstPageImg.style.height = '';
        firstPageImg.style.margin = '';

        // 3. INISIALISASI TURN.JS DENGAN JUMLAH HALAMAN YANG PASTI
        $(flipbook).turn({
            width: bookWidth,
            height: bookHeight,
            autoCenter: true,
            display: isMobile ? 'single' : 'double',
            acceleration: true,
            elevation: 50,
            duration: 600,
            pages: totalPages // Set jumlah halaman sejak awal agar tidak ada error out of range
        });

        // 4. Update hal 1 & tambah halaman lain
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
                await new Promise(r => setTimeout(r, 50)); // Jeda agar UI tidak freeze
            }

            // Tambahkan halaman kosong di akhir jika total genap tapi pdf ganjil (hanya desktop)
            if (!isMobile && pdf.numPages % 2 !== 0) {
                const emptyPage = document.createElement('div');
                emptyPage.className = 'flipbook-page bg-white';
                $(flipbook).turn('addPage', emptyPage, totalPages);
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
    document.body.style.overflow = ''; // Kembalikan scroll
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
        const tempId = 'temp_' + Date.now();

        saveBtn.disabled = true;
        saveBtn.innerText = 'MEMPROSES...';
        
        // 2. PARALLEL PREPARATION (Kompresi Gambar & Setup Optimistic UI)
        // Kita jalankan kompresi gambar secara paralel dengan persiapan UI
        let compressedBlob = null;
        let localCoverUrl = null;

        const prepareCoverPromise = async () => {
            if (coverFile) {
                const canvas = document.createElement('canvas');
                const img = new Image();
                img.src = URL.createObjectURL(coverFile);
                compressedBlob = await new Promise(res => {
                    img.onload = () => {
                        const ctx = canvas.getContext('2d');
                        const scale = Math.min(1, 400 / img.width); // Maksimal lebar 400px
                        canvas.width = img.width * scale; 
                        canvas.height = img.height * scale;
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        canvas.toBlob(res, 'image/jpeg', 0.6); // Kompresi agresif 60% quality
                    }
                });
                localCoverUrl = URL.createObjectURL(compressedBlob);
            }
        };

        const setupUIPromise = async () => {
            // Optimistic UI: Tampilkan di UI seketika
            const newBook = {
                id: tempId,
                title: title,
                author: author,
                coverUrl: localCoverUrl, // Akan diisi jika cover selesai
                status: 'uploading',
                createdAt: new Date()
            };
            localPendingBooks.push(newBook);
            books = [newBook, ...books];
            render();
            // Simpan PDF ke cache lokal paralel
            saveToLocalDisk(tempId, pdfFile);
        };

        // Eksekusi kompresi dan setup UI secara paralel!
        await Promise.all([prepareCoverPromise(), setupUIPromise()]);

        // Perbarui UI lagi karena localCoverUrl mungkin baru didapat dari promise
        const pendingBookIndex = books.findIndex(b => b.id === tempId);
        if (pendingBookIndex > -1) {
            books[pendingBookIndex].coverUrl = localCoverUrl;
            render();
        }

        alert('✅ Persiapan selesai! Buku ditambahkan. Proses upload berjalan di latar belakang.');
        
        // RESET FORM SEGERA
        e.target.reset();
        document.getElementById('pdf-label').textContent = 'Unggah File PDF';
        document.getElementById('cover-label').textContent = 'Unggah Gambar Sampul';
        const currentPdf = pdfFile; 
        tempFiles = { pdf: null, cover: null };
        saveBtn.disabled = false;
        saveBtn.innerText = originalText;

        // 3. API UPLOAD LOGIC (PROMISE-BASED WITH RETRY & TIMEOUT)
        uploadTasksCount++;
        progressContainer.classList.remove('hidden');
        progressBar.style.width = '5%';
        
        const formData = new FormData();
        formData.append('title', title);
        formData.append('author', author);
        if (compressedBlob) {
            formData.append('cover', compressedBlob, 'cover.jpg');
        }
        formData.append('pdf', currentPdf, currentPdf.name);

        // Fungsi Promise untuk XHR (Mendukung Progress Bar & Timeout)
        const uploadWithRetry = (url, data, retries = 3, timeoutMs = 30000) => {
            return new Promise((resolve, reject) => {
                const attempt = (n) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', url, true);
                    xhr.timeout = timeoutMs;
                    
                    xhr.upload.onprogress = (event) => {
                        if (event.lengthComputable) {
                            const percent = (event.loaded / event.total) * 90; // Sisa 10% untuk server processing
                            progressBar.style.width = (5 + percent) + '%';
                        }
                    };
                    
                    xhr.onload = () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve(xhr.responseText);
                        } else {
                            if (n === 1) reject(new Error('Server Error: ' + xhr.status));
                            else { console.warn(`Retrying... (${retries - n + 1})`); attempt(n - 1); }
                        }
                    };
                    
                    xhr.onerror = xhr.ontimeout = () => {
                        if (n === 1) reject(new Error('Network Error / Timeout'));
                        else { console.warn(`Retrying after error... (${retries - n + 1})`); attempt(n - 1); }
                    };
                    
                    xhr.send(data);
                };
                attempt(retries);
            });
        };

        // Mulai Upload ke Backend
        try {
            const responseText = await uploadWithRetry(API_URL + 'upload.php', formData, 3, 30000); // 3x Retry, 30s Timeout
            const res = JSON.parse(responseText);
            
            if (res.success && res.book) {
                saveToLocalDisk(res.book.id, currentPdf); // Simpan ID asli ke disk
            }
            
            progressBar.style.width = '100%';
            setTimeout(() => {
                progressContainer.classList.add('hidden');
                progressBar.style.width = '0%';
            }, 2000);

        } catch (uploadError) {
            console.error('Upload API Error:', uploadError);
            progressBar.style.backgroundColor = 'red'; // Indikator Error
            setTimeout(() => { progressContainer.classList.add('hidden'); progressBar.style.backgroundColor = ''; }, 3000);
        } finally {
            localPendingBooks = localPendingBooks.filter(b => b.id !== tempId);
            loadBooksFromDB(); // Sinkronisasi ulang data final dari server
            uploadTasksCount--;
        }

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
        const response = await fetch(API_URL + 'delete.php?id=' + id);
        const result = await response.json();
        if (result.success) {
            loadBooksFromDB();
        } else {
            alert('Gagal: ' + result.message);
        }
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
    if (coverUrl.startsWith('http') || coverUrl.startsWith('blob:')) return coverUrl;
    return API_URL + coverUrl;
}

function render() {
    const grid = document.getElementById('book-grid');
    const list = document.getElementById('admin-book-list');

    // --- Render kartu buku di halaman utama ---
    grid.innerHTML = books.map(b => `
        <div class="flex flex-col group cursor-pointer" onclick="openBook('${b.id}')">
            <div class="relative aspect-[3/4] rounded-lg overflow-hidden glass-card mb-stack-sm bg-surface-container">
                <img alt="Sampul ${b.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" src="${getCoverUrl(b.coverUrl)}"/>
                <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center px-4">
                    <button class="w-full py-2 glow-button text-on-primary rounded-lg font-label-sm shadow-lg">Baca Sekarang</button>
                </div>
            </div>
            <h4 class="font-label-md text-label-md text-on-surface line-clamp-1">${b.title}</h4>
            <p class="font-body-sm text-body-sm text-on-surface-variant">${b.author}</p>
            <div class="mt-2 h-1 w-full bg-white/10 rounded-full overflow-hidden">
                <div class="h-full bg-primary-container w-0"></div>
            </div>
            <span class="text-[10px] text-outline mt-1">Baru Ditambahkan</span>
        </div>
    `).join('');

    // --- Render tabel di dashboard admin ---
    list.innerHTML = books.map(b => `
        <tr class="hover:bg-white/5 transition-colors">
            <td class="p-3">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-10 bg-surface-container rounded overflow-hidden shrink-0">
                        <img src="${getCoverUrl(b.coverUrl)}" class="w-full h-full object-cover" alt="Sampul">
                    </div>
                    <div class="min-w-0">
                        <div class="font-semibold text-white text-xs truncate">${b.title}</div>
                        <div class="text-[10px] text-on-surface-variant truncate">${b.author}</div>
                    </div>
                </div>
            </td>
            <td class="p-3 text-right whitespace-nowrap">
                <button onclick="deleteBook('${b.id}')" class="text-error/50 hover:text-error transition-colors p-2">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
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
    sessionStorage.removeItem('isAdmin');
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

    // Check existing admin session
    if (isAdmin) {
        document.getElementById('admin-link')?.classList.remove('hidden');
        document.getElementById('logout-btn')?.classList.remove('hidden');
        document.getElementById('login-link')?.classList.add('hidden');
        document.getElementById('admin-link-mobile')?.classList.remove('hidden');
        document.getElementById('logout-btn-mobile')?.classList.remove('hidden');
        document.getElementById('login-link-mobile')?.classList.add('hidden');
    }

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
            // Normalisasi: Lowercase email untuk menghindari error auto-capitalization di HP
            const email = document.getElementById('email').value.trim().toLowerCase();
            const pass = document.getElementById('password').value.trim();

            if (email === 'admin@perpus.id' && pass === '654321') {
                isAdmin = true;
                sessionStorage.setItem('isAdmin', 'true');
                
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
                alert('Email atau Password salah! Pastikan Email: admin@perpus.id (huruf kecil) dan Password: 654321');
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
