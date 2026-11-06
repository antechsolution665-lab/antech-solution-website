
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({
        success: true,
        message: "ANTECH API is running"
      });
    }

    if (request.method === "POST" && url.pathname === "/api/orders") {
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
          products.length === 0
        ) {
          return Response.json(
            { success: false, message: "Invalid order details" },
            { status: 400 }
          );
        }

        if (!/^[0-9]{10}$/.test(phone)) {
          return Response.json(
            { success: false, message: "Invalid phone number" },
            { status: 400 }
          );
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
          return Response.json(
            { success: false, message: "Invalid products" },
            { status: 400 }
          );
        }

        const total = safeProducts.reduce(
          (sum, p) => sum + p.price * p.quantity,
          0
        );

        if (!Number.isSafeInteger(total) || total !== Number(amount)) {
          return Response.json(
            { success: false, message: "Invalid amount" },
            { status: 400 }
          );
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
          phone,
          String(address).slice(0, 1000),
          total,
          JSON.stringify(safeProducts),
          location ? String(location).slice(0, 200) : null,
          mapLink ? String(mapLink).slice(0, 500) : null
        ).run();

        return Response.json({
          success: true,
          message: "Order received successfully",
          orderId: result.meta.last_row_id
        });

      } catch (error) {
        console.error("Order save error:", error);

        return Response.json(
          {
            success: false,
            message: "Could not save order. Please try again."
          },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
