using System.Diagnostics;
using NEvo.Messaging.Context;

namespace NEvo.Messaging.Handling.Middleware;

public class TelemetryMessageProcessingMiddleware() : IMessageProcessingMiddleware, IMessageProcessingHandlerMiddleware
{
    public static readonly ActivitySource MessageProcessingSource = new("MessageProcessingSource");
    public static readonly ActivitySource MessageProcessingHandlerSource = new("MessageProcessingHandlerSoutce");

    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        using var activity = MessageProcessingSource.CreateActivity("Processing message", ActivityKind.Server);
        activity?.SetTag("message", message.GetType().FullName);

        stopwatch.Start();
        var result = await next();
        stopwatch.Stop();

        result.Match(
            _ => { activity?.SetTag("result", "success"); },
            _ => { activity?.SetTag("result", "failure"); }
        );

        activity?.SetTag("processingTime", stopwatch.ElapsedMilliseconds);

        return result;
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        using var activity = MessageProcessingSource.CreateActivity("Processing message handler", ActivityKind.Server);
        activity?.SetTag("handler", messageHandler.HandlerDescription.Key);
        stopwatch.Start();
        var result = await next();
        stopwatch.Stop();

        result.Match(
            _ => { activity?.SetTag("result", "success"); },
            _ => { activity?.SetTag("result", "failure"); }
        );

        activity?.SetTag("processingTime", stopwatch.ElapsedMilliseconds);

        return result;
    }
}
