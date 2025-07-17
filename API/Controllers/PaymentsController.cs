using System.Security.Cryptography;
using System.Text;
using API.Extensions;
using API.SignalR;
using Core.Entities;
using Core.Entities.OrderAggregate;
using Core.Interfaces;
using Core.Specifications;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json.Linq; // Add this using for JObject

namespace API.Controllers;

public class PaymentsController(IPaymentService paymentService,
    IUnitOfWork unit,
    IHubContext<NotificationHub> hubContext,
    ILogger<PaymentsController> logger,
    IConfiguration config) : BaseApiController
{
    private readonly string _paystackSecret = config["PaystackSettings:SecretKey"]!;

    [Authorize]
    [HttpPost("{cartId}")]
    public async Task<ActionResult<ShoppingCart>> CreateOrUpdatePaymentTransaction(string cartId)
    {
        var cart = await paymentService.CreateOrUpdatePaymentTransaction(cartId);
        if (cart == null) return BadRequest("Problem with your cart on the API");
        return Ok(cart);
    }

    [HttpGet("delivery-methods")]
    public async Task<ActionResult<IReadOnlyList<DeliveryMethod>>> GetDeliveryMethods()
    {
        return Ok(await unit.Repository<DeliveryMethod>().ListAllAsync());
    }

    // This endpoint replaces the Stripe webhook
    [HttpPost("paystack-webhook")]
    public async Task<IActionResult> PaystackWebhook()
    {
        var json = await new StreamReader(Request.Body).ReadToEndAsync();

        // Verify the webhook signature
        var signature = Request.Headers["x-paystack-signature"].ToString();
        var computedHash = ComputeSha512Hash(json, _paystackSecret);
        if (computedHash != signature)
        {
            logger.LogWarning("Paystack webhook signature verification failed.");
            return Unauthorized();
        }

        var paystackEvent = JObject.Parse(json);
        var eventType = paystackEvent["event"]?.ToString();
        var eventData = paystackEvent["data"];

        if (eventType == "charge.success" && eventData != null)
        {
            await HandleChargeSuccess(eventData);
        }

        return Ok();
    }

    private async Task HandleChargeSuccess(JToken eventData)
    {
        // --- 1. Extract data from the webhook payload ---
        var reference = eventData["reference"]?.ToString();
        var amountPaid = eventData["amount"]?.ToObject<long>();
        var authorizationData = eventData["authorization"];

        if (string.IsNullOrEmpty(reference) || !amountPaid.HasValue || authorizationData == null)
        {
            logger.LogError("Paystack webhook 'charge.success' event is missing required data.");
            return;
        }

        // --- 2. Find the existing order in your database ---
        // This now works because the order was created with a 'Pending' status BEFORE payment.
        var spec = new OrderSpecification(reference, true);
        var order = await unit.Repository<Order>().GetEntityWithSpec(spec);

        if (order == null)
        {
            // This is a critical error if it happens, as the order should always exist now.
            logger.LogError("CRITICAL: Order with PaymentReference {Reference} not found.", reference);
            return;
        }

        // --- 3. Update the order properties ---

        // Set the payment summary details from the webhook
        order.PaymentSummary = new PaymentSummary
        {
            Last4 = int.Parse(authorizationData["last4"]?.ToString() ?? "0"),
            Brand = authorizationData["card_type"]?.ToString() ?? "Unknown",
            ExpMonth = int.Parse(authorizationData["exp_month"]?.ToString() ?? "0"),
            ExpYear = int.Parse(authorizationData["exp_year"]?.ToString() ?? "0")
        };

        // Check if the paid amount matches the order total
        var orderTotalInKobo = (long)(order.GetTotal() * 100);
        if (orderTotalInKobo != amountPaid.Value)
        {
            order.Status = OrderStatus.PaymentMismatch;
            logger.LogWarning("Payment mismatch for order {OrderId}. Expected {Expected}, but received {Received}",
                order.Id, orderTotalInKobo, amountPaid.Value);
        }
        else
        {
            order.Status = OrderStatus.PaymentReceived;
        }

        // --- 4. Save changes and notify the client ---

        // CHANGED: Explicitly tell Entity Framework to track changes to the 'order' entity.
        unit.Repository<Order>().Update(order);

        // Save all tracked changes to the database.
        await unit.Complete();

        // Notify the frontend via SignalR that the order is complete. This unblocks the UI.
        var connectionId = NotificationHub.GetConnectionIdByEmail(order.BuyerEmail);
        if (!string.IsNullOrEmpty(connectionId))
        {
            await hubContext.Clients.Client(connectionId).SendAsync("OrderCompleteNotification", order.ToDto());
        }
    }

    private static string ComputeSha512Hash(string text, string key)
    {
        var keyBytes = Encoding.UTF8.GetBytes(key);
        var textBytes = Encoding.UTF8.GetBytes(text);
        using var hash = new HMACSHA512(keyBytes);
        var hashBytes = hash.ComputeHash(textBytes);
        return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
    }
}