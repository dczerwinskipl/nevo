using LanguageExt;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;
using NEvo.Ddd.EventSourcing.Evolving;
using NEvo.Ddd.EventSourcing.Executing;
using NEvo.Ddd.EventSourcing.Handling;
using NEvo.Messaging.Context;
using NEvo.Messaging.Cqrs.Commands;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Originally characterized DeciderCommandHandler's create/mutate paths end-to-end
// (task 01, AC3). Task 03 extracted the load/authorize/decide/append/publish lifecycle
// into IEventSourcedCommandExecutor — HandleAsync now takes an IMessageContext and
// routes through the executor instead of the repository directly; this test's behavior
// and assertions are otherwise unchanged.
public class DeciderCommandHandlerBaselineTests
{
    private readonly AggregateRepository _repository;
    private readonly DeciderRegistry _deciderRegistry;
    private readonly IEventSourcedCommandExecutor _executor;
    private readonly Mock<IMessageContext> _context = new();

    public DeciderCommandHandlerBaselineTests()
    {
        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { typeof(Document) } };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        var decider = new AggregateDecider(deciderProvider);
        _deciderRegistry = new DeciderRegistry([decider]);
        var evolver = new AggregateEvolver(Options.Create(configuration));
        var evolverRegistry = new EvolverRegistry([evolver]);
        _repository = new AggregateRepository(new FakeEventStore(), evolverRegistry);
        _executor = new EventSourcedCommandExecutor(_repository, new FakeEventPublisher());
    }

    private DeciderCommandHandler<TCommand, Document, Guid> CreateHandler<TCommand>()
        where TCommand : Command, IAggregateCommand<Document, Guid>
        => new(_deciderRegistry, _executor, new AllowAllAggregateAuthorization<TCommand, Document, Guid>());

    [Fact]
    public async Task HandleAsync_CreatePath_NoExistingAggregate_PersistsNewStreamAtVersionZero()
    {
        var handler = CreateHandler<CreateDocument>();
        var id = Guid.NewGuid();

        var result = await handler.HandleAsync(new CreateDocument(id, "Data"), _context.Object, CancellationToken.None);

        result.Should().BeRight();
        var loaded = await _repository.LoadAggregateAsync<Document, Guid>(id, CancellationToken.None);
        var (aggregate, version) = loaded.Should().BeRight().Which.Should().BeSome().Which;
        aggregate.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Data");
        version.Should().Be(1);
    }

    [Fact]
    public async Task HandleAsync_MutatePath_ExistingAggregate_AppendsOnTopOfLoadedVersion()
    {
        var createHandler = CreateHandler<CreateDocument>();
        var changeHandler = CreateHandler<ChangeDocument>();
        var id = Guid.NewGuid();
        await createHandler.HandleAsync(new CreateDocument(id, "Data"), _context.Object, CancellationToken.None);

        var result = await changeHandler.HandleAsync(new ChangeDocument(id, "Updated"), _context.Object, CancellationToken.None);

        result.Should().BeRight();
        var loaded = await _repository.LoadAggregateAsync<Document, Guid>(id, CancellationToken.None);
        var (aggregate, version) = loaded.Should().BeRight().Which.Should().BeSome().Which;
        aggregate.Should().BeOfType<EditableDocument>().Which.Data.Should().Be("Updated");
        version.Should().Be(2);
    }
}
