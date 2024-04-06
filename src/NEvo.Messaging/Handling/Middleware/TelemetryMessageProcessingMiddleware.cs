using NEvo.Messaging.Context;
using System.Diagnostics;

namespace NEvo.Messaging.Handling.Middleware;

public class TelemetryMessageProcessingMiddleware() : IMessageProcessingMiddleware, IMessageProcessingHandlerMiddleware
{
    public static readonly ActivitySource MessageProcessingSource = new(Telemetry.MessageProcessing);
    public static readonly ActivitySource MessageProcessingHandlerSource = new(Telemetry.MessageProcessingHandler);

    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        using var activity = MessageProcessingSource.StartActivity($"Processing message: {message.GetType().FullName}", ActivityKind.Server);
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
        using var activity = MessageProcessingSource.StartActivity($"Processing message handler: {messageHandler.HandlerDescription.Key}", ActivityKind.Server);
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
