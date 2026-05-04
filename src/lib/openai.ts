import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function evaluateListing(title: string, description: string, industry: string): Promise<{
  isFranchise: boolean
  isDesignFirm: boolean
  analysis: string
  shouldStore: boolean
}> {
  try {
    const prompt = `
Please analyze this business listing and determine:

1. Is this a FRANCHISE business? (Look for franchise keywords, brand names, franchise fees, etc.)
2. Is this a DESIGN FIRM or creative agency? (Architecture, graphic design, web design, interior design, marketing agency, etc.)

Business Details:
- Title: ${title}
- Industry: ${industry}
- Description: ${description}

Respond in JSON format:
{
  "isFranchise": boolean,
  "isDesignFirm": boolean, 
  "analysis": "Brief explanation of your reasoning",
  "shouldStore": boolean (true if NOT a franchise AND NOT a design firm)
}

Be strict in your evaluation - if there's any indication of franchise or design work, mark it accordingly.
`

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a business analyst expert at identifying franchises and design firms. Respond only with valid JSON."
        },
        {
          role: "user", 
          content: prompt
        }
      ],
      temperature: 0.1,
      max_tokens: 300
    })

    const response = completion.choices[0]?.message?.content
    
    if (!response) {
      throw new Error('No response from OpenAI')
    }

    // Parse the JSON response
    const result = JSON.parse(response)
    
    return {
      isFranchise: result.isFranchise || false,
      isDesignFirm: result.isDesignFirm || false,
      analysis: result.analysis || 'Analysis not available',
      shouldStore: result.shouldStore || false
    }

  } catch (error) {
    console.error('Error evaluating listing with OpenAI:', error)
    
    // Fallback analysis based on keywords
    const titleLower = title.toLowerCase()
    const descLower = description.toLowerCase()
    const industryLower = industry.toLowerCase()
    
    const franchiseKeywords = ['franchise', 'franchisee', 'mcdonalds', 'subway', 'starbucks', 'dominos', 'pizza hut', 'taco bell']
    const designKeywords = ['design', 'creative', 'agency', 'marketing', 'advertising', 'graphic', 'web design', 'architecture']
    
    const isFranchise = franchiseKeywords.some(keyword => 
      titleLower.includes(keyword) || descLower.includes(keyword) || industryLower.includes(keyword)
    )
    
    const isDesignFirm = designKeywords.some(keyword =>
      titleLower.includes(keyword) || descLower.includes(keyword) || industryLower.includes(keyword)
    )
    
    return {
      isFranchise,
      isDesignFirm,
      analysis: 'Fallback keyword analysis used due to API error',
      shouldStore: !isFranchise && !isDesignFirm
    }
  }
}

export { openai }