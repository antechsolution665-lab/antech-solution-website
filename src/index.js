
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const json = (data, status = 200) =>
      Response.json(data, { status });

    // Admin authentication
    const isAdmin = () =>
      Boolean(env.ADMIN_PASSWORD) &&
      request.headers.get("x-admin-password") === env.ADMIN_PASSWORD;

    // Health check
    if (request.method === "GET" && path === "/api/health") {
      return json({
        success: true,
        message: "ANTECH API is running"
      });
    }

    // =========================
    // PRODUCT MANAGEMENT
    // =========================

    // Get products (Public)
    if (request.method === "GET" && path === "/api/products") {
      try {
        const result = await env.DB.prepare(`
          SELECT id, name, description, price, stock, image_url, created_at
          FROM products
          ORDER BY id DESC
        `).all();

        return json({
          success: true,
          products: result.results
        });
      } catch (error) {
        console.error("Get products error:", error);
        return json({
          success: false,
          message: "Could not load products"
        }, 500);
      }
    }

    // Add product (Admin only)
    if (request.method === "POST" && path === "/api/products") {
      if (!isAdmin()) {
        return json({ success: false, message: "Unauthorized" }, 401);
      }

      try {
        const data = await request.json();

        const name = String(data.name || "").trim();
        const description = String(data.description || "").trim();
        const price = Number(data.price);
        const stock = Number(data.stock);
        const imageUrl = String(data.image_url || "").trim();

        if (
          !name ||
          name.length > 150 ||
          !Number.isSafeInteger(price) ||
          price < 0 ||
          !Number.isSafeInteger(stock) ||
          stock < 0 ||
          description.length > 2000 ||
          imageUrl.length > 1000
        ) {
          return json({
            success: false,
            message: "Invalid product details"
          }, 400);
        }

        if (imageUrl) {
          let parsedUrl;
          try {
            parsedUrl = new URL(imageUrl);
          } catch {
            return json({
              success: false,
              message: "Invalid image URL"
            }, 400);
          }

          if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return json({
              success: false,
              message: "Image URL must use HTTP or HTTPS"
            }, 400);
          }
        }

        const result = await env.DB.prepare(`
          INSERT INTO products
          (name, description, price, stock, image_url)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          name,
          description,
          price,
          stock,
          imageUrl || null
        ).run();

        return json({
          success: true,
          message: "Product added successfully",
          productId: result.meta.last_row_id
        });
      } catch (error) {
        console.error("Add product error:", error);
        return json({
          success: false,
          message: "Could not add product"
        }, 500);
      }
    }

    // Update or delete product (Admin only)
    const productMatch = path.match(/^\/api\/products\/(\d+)$/);

    if (productMatch && request.method === "PATCH") {
      if (!isAdmin()) {
        return json({ success: false, message: "Unauthorized" }, 401);
      }

      try {
        const id = Number(productMatch[1]);
        const data = await request.json();

        const fields = [];
        const values = [];

        if (data.name !== undefined) {
          const name = String(data.name).trim();
          if (!name || name.length > 150) {
            return json({ success: false, message: "Invalid product name" }, 400);
          }
          fields.push("name = ?");
          values.push(name);
        }

        if (data.description !== undefined) {
          const description = String(data.description);
          if (description.length > 2000) {
            return json({ success: false, message: "Description too long" }, 400);
          }
          fields.push("description = ?");
          values.push(description);
        }

        if (data.price !== undefined) {
          const price = Number(data.price);
          if (!Number.isSafeInteger(price) || price < 0) {
            return json({ success: false, message: "Invalid price" }, 400);
          }
          fields.push("price = ?");
          values.push(price);
        }

        if (data.stock !== undefined) {
          const stock = Number(data.stock);
          if (!Number.isSafeInteger(stock) || stock < 0) {
            return json({ success: false, message: "Invalid stock" }, 400);
          }
          fields.push("stock = ?");
          values.push(stock);
        }

        if (data.image_url !== undefined) {
          const imageUrl = String(data.image_url).trim();

          if (imageUrl.length > 1000) {
            return json({ success: false, message: "Image URL too long" }, 400);
          }

          if (imageUrl) {
            let parsedUrl;
            try {
              parsedUrl = new URL(imageUrl);
            } catch {
              return json({ success: false, message: "Invalid image URL" }, 400);
            }

            if (!["http:", "https:"].includes(parsedUrl.protocol)) {
              return json({ success: false, message: "Invalid image URL" }, 400);
            }
          }

          fields.push("image_url = ?");
          values.push(imageUrl || null);
        }

        if (fields.length === 0) {
          return json({ success: false, message: "No changes provided" }, 400);
        }

        values.push(id);

        const result = await env.DB.prepare(`
          UPDATE products
          SET ${fields.join(", ")}
          WHERE id = ?
        `).bind(...values).run();

        if (result.meta.changes === 0) {
          return json({ success: false, message: "Product not found" }, 404);
        }

        return json({
          success: true,
          message: "Product updated successfully"
        });
      } catch (error) {
        console.error("Update product error:", error);
        return json({ success: false, message: "Could not update product" }, 500);
      }
    }

    if (productMatch && request.method === "DELETE") {
      if (!isAdmin()) {
        return json({ success: false, message: "Unauthorized" }, 401);
      }

      try {
        const id = Number(productMatch[1]);

        const result = await env.DB.prepare(`
          DELETE FROM products WHERE id = ?
        `).bind(id).run();

        if (result.meta.changes === 0) {
          return json({ success: false, message: "Product not found" }, 404);
        }

        return json({
          success: true,
          message: "Product deleted successfully"
        });
      } catch (error) {
        console.error("Delete product error:", error);
        return json({ success: false, message: "Could not delete product" }, 500);
      }
    }

    // =========================
    // ORDER MANAGEMENT
    // =========================

    // Get all orders (Admin only)
    if (request.method === "GET" && path === "/api/orders") {
      if (!isAdmin()) {
        return json({ success: false, message: "Unauthorized" }, 401);
      }

      try {
        const result = await env.DB.prepare(`
          SELECT
            id,
            customer_name AS customer,
            phone,
            address,
            total_amount AS amount,
            status,
            created_at,
            products,
            location,
            map_link
          FROM orders
          ORDER BY id DESC
        `).all();

        return json({
          success: true,
          orders: result.results
        });
      } catch (error) {
        console.error("Get orders error:", error);
        return json({ success: false, message: "Could not load orders" }, 500);
      }
    }

    const orderMatch = path.match(/^\/api\/orders\/(\d+)$/);

    // Update order status
    if (request.method === "PATCH" && orderMatch) {
      if (!isAdmin()) {
        return json({ success: false, message: "Unauthorized" }, 401);
      }

      try {
        const id = Number(orderMatch[1]);
        const data = await request.json();

        const allowedStatuses = [
          "Pending",
          "Processing",
          "Shipped",
          "Delivered",
          "Cancelled"
        ];

        if (!allowedStatuses.includes(data.status)) {
          return json({ success: false, message: "Invalid order status" }, 400);
        }

        const result = await env.DB.prepare(`
          UPDATE orders SET status = ? WHERE id = ?
        `).bind(data.status, id).run();

        if (result.meta.changes === 0) {
          return json({ success: false, message: "Order not found" }, 404);
        }

        return json({
          success: true,
          message: "Order status updated"
        });
      } catch (error) {
        console.error("Update order error:", error);
        return json({ success: false, message: "Could not update order" }, 500);
      }
    }

    // Delete order
    if (request.method === "DELETE" && orderMatch) {
      if (!isAdmin()) {
        return json({ success: false, message: "Unauthorized" }, 401);
      }

      try {
        const id = Number(orderMatch[1]);

        const result = await env.DB.prepare(`
          DELETE FROM orders WHERE id = ?
        `).bind(id).run();

        if (result.meta.changes === 0) {
          return json({ success: false, message: "Order not found" }, 404);
        }

        return json({
          success: true,
          message: "Order deleted successfully"
        });
      } catch (error) {
        console.error("Delete order error:", error);
        return json({ success: false, message: "Could not delete order" }, 500);
      }
    }

    // Save customer order
    if (request.method === "POST" && path === "/api/orders") {
      try {
        const data = await request.json();

        const {
          customer,
          phone,
          address,
          products,
          amount,
          location,
          mapLink
        } = data;

        if (
          !customer ||
          !phone ||
          !address ||
          !Array.isArray(products) ||
          products.length === 0 ||
          products.length > 50
        ) {
          return json({ success: false, message: "Invalid order details" }, 400);
        }

        if (!/^[0-9]{10}$/.test(String(phone))) {
          return json({ success: false, message: "Invalid phone number" }, 400);
        }

        const safeProducts = products.map(p => ({
          name: String(p.name || "").slice(0, 150),
          price: Number(p.price),
          quantity: Number(p.quantity)
        }));

        if (safeProducts.some(p =>
          !p.name ||
          !Number.isSafeInteger(p.price) ||
          p.price < 0 ||
          !Number.isSafeInteger(p.quantity) ||
          p.quantity < 1
        )) {
          return json({ success: false, message: "Invalid products" }, 400);
        }

        const total = safeProducts.reduce(
          (sum, p) => sum + p.price * p.quantity,
          0
        );

        if (!Number.isSafeInteger(total) || total !== Number(amount)) {
          return json({ success: false, message: "Invalid amount" }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO orders
          (
            customer_name,
            phone,
            address,
            total_amount,
            products,
            status,
            location,
            map_link,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          String(customer).slice(0, 150),
          String(phone),
          String(address).slice(0, 1000),
          total,
          JSON.stringify(safeProducts),
          location ? String(location).slice(0, 200) : null,
          mapLink ? String(mapLink).slice(0, 500) : null
        ).run();

        return json({
          success: true,
          message: "Order received successfully",
          orderId: result.meta.last_row_id
        });
      } catch (error) {
        console.error("Order save error:", error);
        return json({
          success: false,
          message: "Could not save order. Please try again."
        }, 500);
      }
    }

    // Serve website files
    return env.ASSETS.fetch(request);
  }
};
