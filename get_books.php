<?php
require_once 'config.php';

// GET: Mengambil daftar buku
echo json_encode(getBooks());
exit;
?>
