using LanguageExt;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Tests.Deciding;

public class AggregateDeciderTests
{
    private AggregateDecider _decider;

    public AggregateDeciderTests()
    {
        var configuration = new AggregateExtractorConfiguration()
        {
            AggregateTypes = { typeof(DocumentAggregateBase) }
        };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        _decider = new AggregateDecider(deciderProvider);
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithNoAggregateAndCreateCommand_ShouldReturnNewEvents()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = Option<DocumentAggregateBase>.None;
        var data = "Data";

        // act
        var result = await _decider.DecideAsync(
            aggregate,
            new CreateDocument(id, data),
            CancellationToken.None
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeEquivalentTo(
                [new DocumentCreated(id, data)],
                options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
            );
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithNoAggregateAndNonCreateCommand_ShouldReturnError()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = Option<DocumentAggregateBase>.None;

        // act
        var result = await _decider.DecideAsync(
            aggregate,
            new ChangeDocument(id, "Data"),
            CancellationToken.None
        );

        // assert
        result.Should().BeLeft().Which
            .Should().BeOfType<Exception>().Which
            .Message.Should().Contain("No decider found for command ChangeDocument on aggregate DocumentAggregateBase");
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithAggregateAndAvailableCommand_ShouldReturnNewEvents()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = new EditableDocument(id, "OldData");
        var data = "Data";

        // act
        var result = await _decider.DecideAsync(
            aggregate,
            new ChangeDocument(id, data),
            CancellationToken.None
        );

        // assert
        result.Should().BeRight().Which
            .Should().BeEquivalentTo(
                [new DocumentChanged(id, data)],
                options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
            );
    }

    [Fact]
    public async Task DecideAsync_WhenCalledWithAggregateAndNotAvailableCommand_ShouldReturnError()
    {
        // arrange
        var id = Guid.NewGuid();
        var aggregate = new EditableDocument(id, "OldData");

        // act
        var result = await _decider.DecideAsync(
            aggregate,
            new CreateDocument(id, "Data"),
            CancellationToken.None
        );

        // assert
        result.Should().BeLeft().Which
            .Should().BeOfType<InvalidOperationException>().Which
            .Message.Should().Contain("Aggregate EditableDocument already exists");
    }
}
