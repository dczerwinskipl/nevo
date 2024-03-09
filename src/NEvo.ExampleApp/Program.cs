// See https://aka.ms/new-console-template for more information
using System.Diagnostics.CodeAnalysis;
using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Core;
using NEvo.Messaging;
using NEvo.Messaging.CQRS.Commands;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Middleware;

var services = new ServiceCollection();

// logging
services.AddLogging(logging =>
{
    logging.AddConsole();
});

//
services.AddSingleton<IMessageHandlerExtractor, MessageHandlerExtractor>();
services.AddSingleton<IMessageHandlerRegistry, MessageHandlerRegistry>();
services.AddSingleton<IMessageProcessingStrategyFactory, MessageProcessingStrategyFactory>();
services.AddSingleton<IMessageProcessor, MessageProcessor>();

// middleware - logging
services.AddSingleton<LoggingMessageProcessingMiddleware>();
services.AddSingleton(sp => new MessageProcessingMiddlewareConfig(sp.GetRequiredService<LoggingMessageProcessingMiddleware>()));

//CQRS
services.AddSingleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>();
services.AddSingleton<IMessageProcessingStrategy, CommandProcessingStrategy>();

var provider = services.BuildServiceProvider();

var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
registry.Register<MyCommandHandler>();


var message = new MyCommand("Hello world!");
//var handler = registry.GetMessageHandler(message);
var processor = provider.GetRequiredService<IMessageProcessor>();
await processor.ProcessMessageAsync(message, null, CancellationToken.None);
await processor.ProcessMessageAsync(message, null, CancellationToken.None);
await processor.ProcessMessageAsync(message, null, CancellationToken.None);
await processor.ProcessMessageAsync(message, null, CancellationToken.None);
await processor.ProcessMessageAsync(message, null, CancellationToken.None);
await processor.ProcessMessageAsync(message, null, CancellationToken.None);
await processor.ProcessMessageAsync(message, null, CancellationToken.None);


public record MyCommand : Command
{
    public string Foo { get; init; }

    public MyCommand(string foo) : base()
    {
        Foo = foo;
    }

    public MyCommand(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}


public class MyCommandHandler : ICommandHandler<MyCommand>
{
    public async Task<Either<Exception, Unit>> HandleAsync(MyCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return Unit.Default;
    }
}
