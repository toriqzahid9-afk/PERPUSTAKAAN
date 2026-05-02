<?php
require_once 'config.php';

// POST: Menambah buku baru
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $title = $_POST['title'] ?? '';
    $author = $_POST['author'] ?? '';
    
    if (!$title || !isset($_FILES['pdf'])) {
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap']);
        exit;
    }
    
    $pdfUrl = null;
    $coverUrl = null;
    
    // Handle PDF upload
    if (isset($_FILES['pdf']) && $_FILES['pdf']['error'] === UPLOAD_ERR_OK) {
        $pdfName = time() . '-' . rand(1000, 9999) . '-' . preg_replace('/[^a-zA-Z0-9.\-_]/', '', basename($_FILES['pdf']['name']));
        if (move_uploaded_file($_FILES['pdf']['tmp_name'], $uploadDir . '/' . $pdfName)) {
            $pdfUrl = 'uploads/' . $pdfName;
        }
    }
    
    // Handle Cover upload
    if (isset($_FILES['cover']) && $_FILES['cover']['error'] === UPLOAD_ERR_OK) {
        $coverName = time() . '-' . rand(1000, 9999) . '-' . preg_replace('/[^a-zA-Z0-9.\-_]/', '', basename($_FILES['cover']['name']));
        if (move_uploaded_file($_FILES['cover']['tmp_name'], $uploadDir . '/' . $coverName)) {
            $coverUrl = 'uploads/' . $coverName;
        }
    }
    
    $books = getBooks();
    $newBook = [
        'id' => (string)time(),
        'title' => $title,
        'author' => $author,
        'pdfUrl' => $pdfUrl,
        'coverUrl' => $coverUrl,
        'createdAt' => date('c')
    ];
    
    array_unshift($books, $newBook);
    saveBooks($books);
    
    echo json_encode(['success' => true, 'book' => $newBook]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Hanya menerima metode POST']);
?>
