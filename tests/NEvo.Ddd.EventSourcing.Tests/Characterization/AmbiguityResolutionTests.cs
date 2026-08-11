using LanguageExt;
using Microsoft.Extensions.Options;
using NEvo.Ddd.EventSourcing.Deciding;

namespace NEvo.Ddd.EventSourcing.Tests.Characterization;

// Proves the deterministic most-specific-wins decider resolution, replacing the old
// first-match behavior AmbiguityResolutionBaselineTests characterized.
public class AmbiguityResolutionTests
{
    private static AggregateDecider CreateDecider()
    {
        var configuration = new AggregateExtractorConfiguration { AggregateTypes = { typeof(Document) } };
        var deciderProvider = new AggregateDeciderProvider(Options.Create(configuration));
        return new AggregateDecider(deciderProvider);
    }

    [Fact]
    public async Task DecideAsync_MostSpecificDeclaringTypeWins()
    {
        var decider = CreateDecider();
        var id = Guid.NewGuid();
        var aggregate = new ReviewableDocument(id, "OldData");

        var result = await decider.DecideAsync<Document, Guid>(
            Option<Document>.Some(aggregate),
            new ChangeDocument(id, "NewData"),
            CancellationToken.None
        );

        // ReviewableDocument is a subtype of EditableDocument, so it is strictly more
        // specific and must win over EditableDocument's own Change decider.
        result.Should().BeRight().Which.Should().BeEquivalentTo(
            [new DocumentChanged(id, "NewData-Reviewable")],
            options => options.Excluding(e => e.Id).Excluding(e => e.CreatedAt)
        );
    }

    [Fact]
    public async Task DecideAsync_EquallySpecificCandidates_FailsDeterministicallyNamingBothCandidates()
    {
        var decider = CreateDecider();
        var id = Guid.NewGuid();
        var aggregate = new ReviewableDocument(id, "Data");

        // MarkReviewed and FinishReview are two differently-named methods declared on
        // the exact same type (ReviewableDocument) for the same command — neither is
        // more specific than the other.
        var result = await decider.DecideAsync<Document, Guid>(
            Option<Document>.Some(aggregate),
            new ReviewDocument(id),
            CancellationToken.None
        );

        result.Should().BeLeft().Which.Message.Should()
            .Contain("Ambiguous decider")
            .And.Contain("ReviewDocument")
            .And.Contain("ReviewableDocument");
    }
}
