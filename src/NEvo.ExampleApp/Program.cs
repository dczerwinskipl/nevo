using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.ExampleApp.ExampleDomain;
using NEvo.Messaging;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

var services = new ServiceCollection();

// logging
services.AddLogging(logging =>
{
    logging.AddConsole();
});

// middleware - logging
services.UseMessages();
services.UseMessageProcessingMiddleware<LoggingMessageProcessingMiddleware>();
services.UseEvents();
services.UseCommands();

var provider = services.BuildServiceProvider();

var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
var processor = provider.GetRequiredService<IMessageProcessor>();

registry.AddExampleDomain();

var messageContext = new MessageContext(new Dictionary<string, string> {
    { "app-name",  "NEvo.ExampleApp" },
    { MessageContextHeaders.CorrelationIdKey, Guid.NewGuid().ToString() },
    { MessageContextHeaders.CausationIdKey, Guid.NewGuid().ToString() },
}, provider);

await Execute(new MyCommand("Hello world!"));
await Execute(new MyEvent("Hello world!"));

async Task Execute(IMessage message)
{
    var result = await processor.ProcessMessageAsync(message, messageContext, CancellationToken.None);
    result.Match(
        Right: _ => Console.WriteLine($"Success: {message.Id}"),
        Left: _ => Console.WriteLine($"Failure: {message.Id}")
   );
}
