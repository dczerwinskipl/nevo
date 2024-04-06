using Microsoft.Extensions.Logging;
using NEvo.Messaging.Context;
using System.Diagnostics;

namespace NEvo.Messaging.Handling.Middleware;

public class LoggingMessageProcessingMiddleware(ILogger<LoggingMessageProcessingMiddleware> logger) : IMessageProcessingMiddleware, IMessageProcessingHandlerMiddleware
{
    public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        logger.LogInformation("Processing message #{MessageId} started", message.Id);

        stopwatch.Start();
        var result = await next();
        stopwatch.Stop();

        result.Match(
            _ => logger.LogInformation("Processing message #{MessageId} finished with success in {Time} ms", message.Id, stopwatch.ElapsedMilliseconds),
            exc => logger.LogError(exc, "Processing message #{MessageId} finished with exception in {Time} ms", message.Id, stopwatch.ElapsedMilliseconds)
        );

        return result;
    }

    public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
    {
        var stopwatch = new Stopwatch();
        logger.LogInformation("Handler {Handler} for message #{MessageId} started", messageHandler.HandlerDescription.Key, message.Id);

        stopwatch.Start();
        var result = await next();
        stopwatch.Stop();

        result.Match(
            _ => logger.LogInformation("Handler {Handler} for message #{MessageId} finished with success in {Time} ms", messageHandler.HandlerDescription.Key, message.Id, stopwatch.ElapsedMilliseconds),
            exc => logger.LogError(exc, "Handler {Handler} for message #{MessageId} finished with exception in {Time} ms", messageHandler.HandlerDescription.Key, message.Id, stopwatch.ElapsedMilliseconds)
        );

        return result;
    }
}
