using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;
using NEvo.Messaging.Cqrs.Queries;
using NEvo.Messaging.Events;
using NEvo.Messaging.Handling;
using NEvo.Messaging.Handling.Exceptions;
using NEvo.Messaging.Handling.Middleware;
using NEvo.Messaging.Handling.Strategies;

namespace NEvo.Messaging.Cqrs.Tests.Queries;

public class QueryDispatchIntegrationTests
{
    private static ServiceProvider BuildProvider(Action<IServiceCollection> configure)
    {
        var services = new ServiceCollection();
        services.AddSingleton<ILogger<MessageHandlerAdapter>>(NullLogger<MessageHandlerAdapter>.Instance);
        services.AddMessages();
        services.AddQueries();
        configure(services);

        return services.BuildServiceProvider();
    }

    [Fact]
    public async Task DispatchAsync_ResolvesHandlerFromDI_AndReturnsTypedResult()
    {
        // Arrange
        var greeterMock = new Mock<IGreeter>();
        greeterMock.Setup(g => g.Greet("Ada")).Returns("Hello, Ada");
        using var provider = BuildProvider(services =>
        {
            services.AddSingleton(greeterMock.Object);
            services.Configure<MessageHandlerExtractorConfiguration>(o => o.Handlers.Add(typeof(GreetingQueryHandler)));
        });
        using var scope = provider.CreateScope();

        // Act
        var result = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None);

        // Assert
        result.Should().BeRight().Which.Should().Be("Hello, Ada");
        greeterMock.Verify(g => g.Greet("Ada"), Times.Once);
    }

    [Fact]
    public async Task DispatchAsync_NoHandlerRegistered_ReturnsNoHandlerFoundException()
    {
        // Arrange
        using var provider = BuildProvider(services => services.Configure<MessageHandlerExtractorConfiguration>(_ => { }));
        using var scope = provider.CreateScope();

        // Act
        var result = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None);

        // Assert
        result.Should().BeLeft().Which.Should().BeOfType<NoHandlerFoundException>();
    }

    [Fact]
    public async Task DispatchAsync_MultipleHandlersRegistered_ReturnsMoreThanOneHandlerFoundException()
    {
        // Arrange
        using var provider = BuildProvider(services =>
        {
            services.AddSingleton(Mock.Of<IGreeter>());
            services.Configure<MessageHandlerExtractorConfiguration>(o =>
            {
                o.Handlers.Add(typeof(GreetingQueryHandler));
                o.Handlers.Add(typeof(SecondGreetingQueryHandler));
            });
        });
        using var scope = provider.CreateScope();

        // Act
        var result = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None);

        // Assert
        result.Should().BeLeft().Which.Should().BeOfType<MoreThanOneHandlerFoundException>();
    }

    [Fact]
    public async Task DispatchAsync_TwoDifferentResultTypes_BothDispatchCorrectly_ThroughOneSharedStrategyInstance()
    {
        // Arrange
        using var provider = BuildProvider(services =>
        {
            services.AddSingleton(Mock.Of<IGreeter>(g => g.Greet("Ada") == "Hi Ada"));
            services.Configure<MessageHandlerExtractorConfiguration>(o =>
            {
                o.Handlers.Add(typeof(GreetingQueryHandler));
                o.Handlers.Add(typeof(CountQueryHandler));
            });
        });
        using var scope = provider.CreateScope();
        var strategyInstances = scope.ServiceProvider.GetServices<IMessageProcessingStrategyWithResult>()
            .OfType<QueryProcessingStrategy>().ToList();

        // Act
        var greetingResult = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None);
        var countResult = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new CountQuery(21), CancellationToken.None);

        // Assert
        greetingResult.Should().BeRight().Which.Should().Be("Hi Ada");
        countResult.Should().BeRight().Which.Should().Be(42);
        strategyInstances.Should().HaveCount(1);
    }

    [Fact]
    public void AddQueries_CalledTwice_RegistersEachServiceExactlyOnce()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        services.AddQueries();
        services.AddQueries();

        // Assert
        services.Count(d => d.ServiceType == typeof(IMessageHandlerFactory) && d.ImplementationType == typeof(QueryHandlerAdapterFactory))
            .Should().Be(1);
        services.Count(d => d.ServiceType == typeof(IMessageProcessingStrategyWithResult) && d.ImplementationType == typeof(QueryProcessingStrategy))
            .Should().Be(1);
        services.Should().ContainSingle(d => d.ServiceType == typeof(IQueryDispatcher));
    }

    [Fact]
    public async Task ComposedRegistration_CommandEventAndQueryDispatch_AllWorkIndependently()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<ILogger<MessageHandlerAdapter>>(NullLogger<MessageHandlerAdapter>.Instance);
        services.AddMessages();
        services.AddCommands();
        services.AddEvents();
        services.AddQueries();
        services.AddSingleton(Mock.Of<IGreeter>(g => g.Greet("Ada") == "Hi Ada"));
        services.Configure<MessageHandlerExtractorConfiguration>(o =>
        {
            o.Handlers.Add(typeof(GreetingQueryHandler));
            o.Handlers.Add(typeof(ComposedCommandHandler));
            o.Handlers.Add(typeof(ComposedEventHandler));
        });
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var sp = scope.ServiceProvider;

        // Act
        var commandResult = await sp.GetRequiredService<ICommandDispatcher>().DispatchAsync(new ComposedCommand(), CancellationToken.None);
        var eventResult = await sp.GetRequiredService<IEventPublisher>().PublishAsync(new ComposedEvent(), CancellationToken.None);
        var queryResult = await sp.GetRequiredService<IQueryDispatcher>().DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None);

        // Assert
        commandResult.Should().BeRight();
        eventResult.Should().BeRight();
        queryResult.Should().BeRight().Which.Should().Be("Hi Ada");
    }

    [Fact]
    public async Task CommandAndQueryDispatch_ExecuteMessageAndHandlerMiddleware_InTheSameRelativeOrder()
    {
        // Arrange / Act
        var commandLog = await RunWithMiddlewareRecording(
            services =>
            {
                services.AddCommands();
                services.Configure<MessageHandlerExtractorConfiguration>(o => o.Handlers.Add(typeof(RecordingCommandHandler)));
            },
            sp => sp.GetRequiredService<ICommandDispatcher>().DispatchAsync(new RecordingCommand(), CancellationToken.None)
        );
        var queryLog = await RunWithMiddlewareRecording(
            services =>
            {
                services.AddQueries();
                services.AddSingleton(Mock.Of<IGreeter>(g => g.Greet("Ada") == "Hi"));
                services.Configure<MessageHandlerExtractorConfiguration>(o => o.Handlers.Add(typeof(GreetingQueryHandler)));
            },
            sp => sp.GetRequiredService<IQueryDispatcher>().DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None)
        );

        // Assert
        queryLog.Should().Equal(commandLog);
        queryLog.Should().Equal("message-start", "handler-start", "handler-end", "message-end");
    }

    private static async Task<List<string>> RunWithMiddlewareRecording(Action<IServiceCollection> configure, Func<IServiceProvider, Task> dispatch)
    {
        var log = new List<string>();
        var services = new ServiceCollection();
        services.AddSingleton<ILogger<MessageHandlerAdapter>>(NullLogger<MessageHandlerAdapter>.Instance);
        services.AddSingleton(log);
        services.AddMessages();
        services.AddMessageProcessingMiddleware<OrderRecordingMessageMiddleware>();
        services.AddMessageProcessingHandlerMiddleware<OrderRecordingHandlerMiddleware>();
        configure(services);

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        await dispatch(scope.ServiceProvider);

        return log;
    }

    [Fact]
    public async Task DispatchAsync_PropagatesCancellationToken_ToTheHandler()
    {
        // Arrange
        using var provider = BuildProvider(services =>
            services.Configure<MessageHandlerExtractorConfiguration>(o => o.Handlers.Add(typeof(CancellationQueryHandler))));
        using var scope = provider.CreateScope();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        // Act
        var result = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new CancellationQuery(), cts.Token);

        // Assert
        result.Should().BeRight().Which.Should().BeTrue();
    }

    [Fact]
    public async Task AddQueriesAlone_WithoutAddCommands_IsSufficientToDispatchAQuery()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<ILogger<MessageHandlerAdapter>>(NullLogger<MessageHandlerAdapter>.Instance);
        services.AddMessages();
        services.AddQueries();
        services.AddSingleton(Mock.Of<IGreeter>(g => g.Greet("Ada") == "Hi Ada"));
        services.Configure<MessageHandlerExtractorConfiguration>(o => o.Handlers.Add(typeof(GreetingQueryHandler)));
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        // Act
        var result = await scope.ServiceProvider.GetRequiredService<IQueryDispatcher>()
            .DispatchAsync(new GreetingQuery("Ada"), CancellationToken.None);

        // Assert
        result.Should().BeRight().Which.Should().Be("Hi Ada");
        services.Should().NotContain(d => d.ServiceType == typeof(ICommandDispatcher));
    }

    public interface IGreeter
    {
        string Greet(string name);
    }

    private record GreetingQuery(string Name) : Query<string>;
    private record CountQuery(int Value) : Query<int>;
    private record CancellationQuery : Query<bool>;
    private record ComposedCommand : Command;
    private record ComposedEvent : Event;
    private record RecordingCommand : Command;

    private class GreetingQueryHandler(IGreeter greeter) : IQueryHandler<GreetingQuery, string>
    {
        public Task<Either<Exception, string>> HandleAsync(GreetingQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, string>.Right(greeter.Greet(query.Name)));
    }

    private class SecondGreetingQueryHandler : IQueryHandler<GreetingQuery, string>
    {
        public Task<Either<Exception, string>> HandleAsync(GreetingQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, string>.Right("other"));
    }

    private class CountQueryHandler : IQueryHandler<CountQuery, int>
    {
        public Task<Either<Exception, int>> HandleAsync(CountQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, int>.Right(query.Value * 2));
    }

    private class CancellationQueryHandler : IQueryHandler<CancellationQuery, bool>
    {
        public Task<Either<Exception, bool>> HandleAsync(CancellationQuery query, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, bool>.Right(cancellationToken.IsCancellationRequested));
    }

    private class ComposedCommandHandler : ICommandHandler<ComposedCommand>
    {
        public Task<Either<Exception, Unit>> HandleAsync(ComposedCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }

    private class ComposedEventHandler : IEventHandler<ComposedEvent>
    {
        public Task<Either<Exception, Unit>> HandleAsync(ComposedEvent message, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }

    private class RecordingCommandHandler : ICommandHandler<RecordingCommand>
    {
        public Task<Either<Exception, Unit>> HandleAsync(RecordingCommand message, IMessageContext messageContext, CancellationToken cancellationToken)
            => Task.FromResult(Either<Exception, Unit>.Right(Unit.Default));
    }

    private class OrderRecordingMessageMiddleware(List<string> log) : IMessageProcessingMiddleware
    {
        public async Task<Either<Exception, object>> ExecuteAsync(IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
        {
            log.Add("message-start");
            var result = await next();
            log.Add("message-end");
            return result;
        }
    }

    private class OrderRecordingHandlerMiddleware(List<string> log) : IMessageProcessingHandlerMiddleware
    {
        public async Task<Either<Exception, object>> ExecuteAsync(IMessageHandler messageHandler, IMessage message, IMessageContext context, Func<Task<Either<Exception, object>>> next, CancellationToken cancellationToken)
        {
            log.Add("handler-start");
            var result = await next();
            log.Add("handler-end");
            return result;
        }
    }
}
