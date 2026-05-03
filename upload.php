<?php
require_once 'config.php';

// POST: Menambah buku baru
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $title = $_POST['title'] ?? '';
    $author = $_POST['author'] ?? '';
    
    // Error Handling: Cek koneksi terputus / partial upload
    if (isset($_FILES['pdf']['error']) && $_FILES['pdf']['error'] !== UPLOAD_ERR_OK) {
        $errorMsg = 'Gagal upload PDF.';
        if ($_FILES['pdf']['error'] === UPLOAD_ERR_PARTIAL) {
            $errorMsg = 'Koneksi terputus saat upload file. Silakan coba lagi.';
        } elseif ($_FILES['pdf']['error'] === UPLOAD_ERR_INI_SIZE || $_FILES['pdf']['error'] === UPLOAD_ERR_FORM_SIZE) {
            $errorMsg = 'Ukuran file melampaui batas server.';
        }
        echo json_encode(['success' => false, 'message' => $errorMsg]);
        exit;
    }

    if (!$title || !isset($_FILES['pdf'])) {
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap']);
        exit;
    }
    
    $bookId = (string)time();
    
    // Setup nama file
    $pdfName = $bookId . '-' . rand(1000, 9999) . '-' . preg_replace('/[^a-zA-Z0-9.\-_]/', '', basename($_FILES['pdf']['name']));
    $pdfUrl = 'uploads/' . $pdfName;
    
    $coverUrl = null;
    $coverName = null;
    if (isset($_FILES['cover']) && $_FILES['cover']['error'] === UPLOAD_ERR_OK) {
        $coverName = $bookId . '-' . rand(1000, 9999) . '-' . preg_replace('/[^a-zA-Z0-9.\-_]/', '', basename($_FILES['cover']['name']));
        $coverUrl = 'uploads/' . $coverName;
    }
    
    // 1. Simpan metadata segera ke database
    $books = getBooks();
    $newBook = [
        'id' => $bookId,
        'title' => $title,
        'author' => $author,
        'pdfUrl' => $pdfUrl,
        'coverUrl' => $coverUrl,
        'createdAt' => date('c'),
        'status' => 'processing' // Flag untuk asinkron
    ];
    
    array_unshift($books, $newBook);
    saveBooks($books);
    
    // 2. Asynchronous Processing: Kirim respon sukses segera ke client
    // Flush output buffer sehingga koneksi HTTP tertutup di sisi client
    if (ob_get_level()) ob_end_clean();
    header("Connection: close");
    ignore_user_abort(true); // Pastikan script lanjut walau client putus
    ob_start();
    
    echo json_encode([
        'success' => true, 
        'book' => $newBook,
        'message' => 'Metadata tersimpan, proses finalisasi file berjalan di background.'
    ]);
    
    $size = ob_get_length();
    header("Content-Length: $size");
    ob_end_flush();
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request(); // Spesifik untuk PHP-FPM (Nginx/InfinityFree)
    }
    
    // -------------------------------------------------------------------
    // BACKGROUND PROCESS: Finalisasi file dan Revalidasi
    // -------------------------------------------------------------------

    // 3. Stream Upload: Pindahkan file temporary ke tujuan akhir dengan chunk stream
    // Menghemat memori RAM (PHP stream abstraction) daripada memuat seluruh file
    function streamMoveFile($source, $destination) {
        $srcStream = fopen($source, 'r');
        $destStream = fopen($destination, 'w');
        if ($srcStream && $destStream) {
            stream_copy_to_stream($srcStream, $destStream);
            fclose($srcStream);
            fclose($destStream);
            unlink($source); // Hapus temp
            return true;
        }
        return false;
    }

    $pdfMoved = streamMoveFile($_FILES['pdf']['tmp_name'], $uploadDir . '/' . $pdfName);
    
    if ($coverName && isset($_FILES['cover'])) {
        streamMoveFile($_FILES['cover']['tmp_name'], $uploadDir . '/' . $coverName);
    }
    
    // 4. Public Revalidation: Update status buku & trigger webhook/timestamp
    if ($pdfMoved) {
        // Ambil ulang database (karena bisa saja berubah saat proses di atas)
        $latestBooks = getBooks();
        foreach ($latestBooks as &$b) {
            if ($b['id'] === $bookId) {
                unset($b['status']); // Hapus flag processing
                $b['ready'] = true;
                break;
            }
        }
        saveBooks($latestBooks);
        
        // Buat file trigger untuk revalidasi frontend (polling/webhook pattern)
        file_put_contents($dataDir . '/revalidate_trigger.txt', time());
    }
    
    exit;
}

echo json_encode(['success' => false, 'message' => 'Hanya menerima metode POST']);
?>
