using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NEvo.Core;
using NEvo.Messaging;
using NEvo.Messaging.CQRS.Commands;
using NEvo.Messaging.CQRS.Events;
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

// Events
services.AddSingleton<IMessageHandlerFactory, EventHandlerAdapterFactory>();
services.AddSingleton<IMessageProcessingStrategy, EventProcessingStrategy>();

// CQRS
services.AddSingleton<IMessageHandlerFactory, CommandHandlerAdapterFactory>();
services.AddSingleton<IMessageProcessingStrategy, CommandProcessingStrategy>();

var provider = services.BuildServiceProvider();

var registry = provider.GetRequiredService<IMessageHandlerRegistry>();
registry.Register<MyCommandHandler>();
registry.Register<MyEventHandlerA>();
registry.Register<MyEventHandlerB>();

var processor = provider.GetRequiredService<IMessageProcessor>();
var messageContext = new MessageContext(new Dictionary<string, string> {
    { "app-name",  "NEvo.ExampleApp" },
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

public record MyEvent : Event
{
    public string Foo { get; init; }

    public MyEvent(string foo) : base()
    {
        Foo = foo;
    }

    public MyEvent(Guid id, DateTime createdAt, string foo) : base(id, createdAt)
    {
        Foo = foo;
    }
}
public class MyCommandHandler : ICommandHandler<MyCommand>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine(message.Foo);

        return UnitExt.DefaultEitherTask;
    }
}


public class MyEventHandlerA : IEventHandler<MyEvent>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyEvent message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine($"HandlerA: {message.Foo}");

        return UnitExt.DefaultEitherTask;
    }
}

public class MyEventHandlerB : IEventHandler<MyEvent>
{
    public Task<Either<Exception, Unit>> HandleAsync(MyEvent message, IMessageContext messageContext, CancellationToken cancellationToken)
    {
        Console.WriteLine($"HandlerB: {message.Foo}");
        throw new Exception(message.Foo);
    }
}
